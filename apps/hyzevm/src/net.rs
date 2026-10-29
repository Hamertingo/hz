//! Firewall de saída por máquina: a VM só fala com o proxy do host. O QEMU sobe com `restrict=on` (a VM não
//! alcança nem o loopback do host, nem a internet) e o proxy chega a ela por um túnel `ssh -R` (127.0.0.1:3128
//! na VM). O proxy libera só os sites da lista, só endereços públicos, e limita a banda.
use crate::{activity, ssh, store::*};
use anyhow::{bail, Result};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Porta do proxy dentro da VM, onde o túnel `ssh -R` termina.
pub const GUEST_PORT: u16 = 3128;
pub const GUEST_PROXY: &str = "http://127.0.0.1:3128";

/// Se um endereço é da internet pública. O proxy só conecta a endereços assim: um nome liberado na lista que
/// aponte para o loopback, a rede local ou os metadados de nuvem (169.254.169.254) seria um caminho até o host.
pub fn is_public(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(a) => {
            let o = a.octets();
            !(a.is_private() || a.is_loopback() || a.is_link_local() || a.is_unspecified() || a.is_broadcast() || a.is_multicast()
                || a.is_documentation()
                || (o[0] == 100 && o[1] & 0xc0 == 64)          // 100.64/10 (CGNAT)
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)     // 192.0.0.0/24
                || (o[0] == 192 && o[1] == 88 && o[2] == 99)   // 6to4 relay
                || (o[0] == 198 && o[1] & 0xfe == 18)          // 198.18/15
                || o[0] >= 240)                                // reservado
        }
        IpAddr::V6(a) => {
            let s = a.segments();
            // IPv4 dentro de IPv6 (::ffff:a.b.c.d): vale a regra do IPv4.
            if let Some(v4) = a.to_ipv4_mapped() { return is_public(IpAddr::V4(v4)); }
            !(a.is_loopback() || a.is_unspecified() || a.is_multicast()
                || s[0] & 0xfe00 == 0xfc00                     // fc00::/7
                || s[0] & 0xffc0 == 0xfe80 || s[0] & 0xffc0 == 0xfec0 // link-local e site-local
                || (s[0] == 0x64 && s[1] == 0xff9b)            // NAT64
                || (s[0] == 0x2001 && (s[1] == 0 || s[1] == 0xdb8)) // Teredo e documentação
                || s[0] == 0x2002                              // 6to4
                || (s[0] == 0x100 && s[1] == 0 && s[2] == 0 && s[3] == 0)) // 100::/64
        }
    }
}

pub fn allowed(list: &[String], host: &str) -> bool {
    let h = host.trim_end_matches('.').to_lowercase();
    list.iter().any(|a| {
        let a = a.trim().trim_start_matches("*.").to_lowercase();
        a == "*" || h == a || h.ends_with(&format!(".{a}"))
    })
}

/// Balde de fichas simples compartilhado por todas as conexões da máquina.
struct Limiter { kbps: u64, next: Mutex<Instant> }
impl Limiter {
    fn take(&self, n: usize) {
        if self.kbps == 0 { return; }
        let cost = Duration::from_micros(n as u64 * 1_000_000 / (self.kbps * 1024));
        let wait = { let mut t = self.next.lock().unwrap(); let now = Instant::now(); let at = (*t).max(now); *t = at + cost; at - now };
        if !wait.is_zero() { std::thread::sleep(wait); }
    }
}

fn pipe(mut from: TcpStream, mut to: TcpStream, lim: Arc<Limiter>) {
    let mut buf = [0u8; 16 * 1024];
    while let Ok(n) = from.read(&mut buf) {
        if n == 0 || to.write_all(&buf[..n]).is_err() { break; }
        lim.take(n);
    }
    let _ = to.shutdown(std::net::Shutdown::Write);
}

fn handle(mut c: TcpStream, m: Machine, lim: Arc<Limiter>, seen: Arc<Mutex<Vec<(String, Instant)>>>) {
    let _ = c.set_read_timeout(Some(Duration::from_secs(30)));
    let mut head = Vec::new();
    let mut b = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") && head.len() < 16 * 1024 {
        match c.read(&mut b) { Ok(1) => head.push(b[0]), _ => return }
    }
    let text = String::from_utf8_lossy(&head).to_string();
    let first = text.lines().next().unwrap_or("");
    let mut p = first.split_whitespace();
    let (method, target) = (p.next().unwrap_or(""), p.next().unwrap_or(""));
    let (host, port, rewritten) = if method.eq_ignore_ascii_case("CONNECT") {
        let (h, pt) = target.rsplit_once(':').unwrap_or((target, "443"));
        (h.to_string(), pt.parse().unwrap_or(443u16), None)
    } else if let Some(rest) = target.strip_prefix("http://") {
        let (hp, path) = rest.split_once('/').map_or((rest, "/".to_string()), |(a, b)| (a, format!("/{b}")));
        let (h, pt) = hp.rsplit_once(':').map_or((hp, 80u16), |(a, b)| (a, b.parse().unwrap_or(80)));
        let req = text.replacen(target, &path, 1);
        (h.to_string(), pt, Some(req))
    } else { let _ = c.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n"); return };

    if !allowed(&m.net_allow, &host) {
        let _ = c.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        // anota no registro (no máx. 1 vez por minuto por site)
        let mut s = seen.lock().unwrap();
        s.retain(|(_, t)| t.elapsed() < Duration::from_secs(60));
        if !s.iter().any(|(h, _)| *h == host) { s.push((host.clone(), Instant::now())); activity::log(&m, "net-blocked", &host); }
        return;
    }
    // Resolve aqui, uma vez, e conecta no endereço que foi checado (um nome que muda de resposta não ajuda).
    let addrs: Vec<_> = (host.as_str(), port).to_socket_addrs().map(|a| a.collect()).unwrap_or_default();
    if addrs.is_empty() || addrs.iter().any(|a| !is_public(a.ip())) {
        let _ = c.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        activity::log(&m, "net-blocked", &format!("{host} (endereço não público)"));
        return;
    }
    let target = addrs.iter().find(|a| a.is_ipv4()).unwrap_or(&addrs[0]);
    let Some(up) = TcpStream::connect_timeout(target, Duration::from_secs(10)).ok() else {
        let _ = c.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"); return };
    let _ = c.set_read_timeout(None);
    match rewritten {
        None => { let _ = c.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n"); }
        Some(req) => { if (&up).write_all(req.as_bytes()).is_err() { return; } }
    }
    let (Ok(c2), Ok(up2)) = (c.try_clone(), up.try_clone()) else { return };
    let l2 = lim.clone();
    std::thread::spawn(move || pipe(up2, c2, l2));
    pipe(c, up, lim);
}

/// Mantém o túnel entre a VM e o proxy enquanto a máquina roda. Uma VM pausada não responde, então o túnel
/// fica fechado e volta quando ela retoma. Um túnel que cai (ou que não subiu porque a VM ainda boota) é
/// aberto de novo a cada 3 s.
fn tunnel_loop(name: &str, proxy_port: u16) {
    let mut tunnel: Option<std::process::Child> = None;
    let close = |t: &mut Option<std::process::Child>| if let Some(mut c) = t.take() { let _ = c.kill(); let _ = c.wait(); };
    loop {
        std::thread::sleep(Duration::from_secs(3));
        let Ok(m) = Machine::load(name) else { close(&mut tunnel); return };
        if !crate::qemu::is_running(&m) || crate::qemu::state(&m) == "paused" { close(&mut tunnel); continue; }
        if tunnel.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None))) { continue; }
        close(&mut tunnel);
        tunnel = ssh::tunnel(&m, GUEST_PORT, proxy_port).ok();
    }
}

/// Processo do proxy (`hyzevm _netproxy <nome>`): escuta e vive enquanto a máquina existir ligada.
pub fn run_proxy(name: &str) -> Result<()> {
    activity::set_actor("net");
    let m = Machine::load(name)?;
    if m.net_allow.is_empty() || m.net_proxy_port == 0 { return Ok(()); }
    let l = TcpListener::bind(("127.0.0.1", m.net_proxy_port))?;
    let lim = Arc::new(Limiter { kbps: m.net_limit_kbps, next: Mutex::new(Instant::now()) });
    let seen = Arc::new(Mutex::new(Vec::new()));
    let n = name.to_string();
    let tunnel_name = name.to_string();
    let proxy_port = m.net_proxy_port;
    std::thread::spawn(move || tunnel_loop(&tunnel_name, proxy_port));
    // some junto com a máquina (60 s depois de ela parar)
    std::thread::spawn(move || {
        let mut down = 0;
        loop {
            std::thread::sleep(Duration::from_secs(10));
            match Machine::load(&n) { Ok(m) if crate::qemu::is_running(&m) => down = 0, Ok(_) => { down += 10; if down >= 60 { std::process::exit(0); } } Err(_) => std::process::exit(0) }
        }
    });
    for c in l.incoming().flatten() {
        let Ok(m) = Machine::load(name) else { return Ok(()) }; // lê a lista atual a cada conexão
        let (lim, seen) = (lim.clone(), seen.clone());
        std::thread::spawn(move || handle(c, m, lim, seen));
    }
    Ok(())
}

/// Garante o proxy (e com ele o túnel) no ar antes de a VM subir.
pub fn ensure_proxy(m: &Machine) -> Result<()> {
    if m.net_allow.is_empty() || m.net_proxy_port == 0 { return Ok(()); }
    let up = || TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], m.net_proxy_port)), Duration::from_millis(300)).is_ok();
    if up() { return Ok(()); }
    let mut c = std::process::Command::new(std::env::current_exe()?);
    c.args(["_netproxy", &m.name]).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(unix)] { use std::os::unix::process::CommandExt; c.process_group(0); }
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x00000008 | 0x00000200); }
    c.spawn()?;
    for _ in 0..30 { if up() { return Ok(()); } std::thread::sleep(Duration::from_millis(100)); }
    bail!("o proxy de rede não subiu")
}

/// Escreve (ou remove) a configuração de proxy dentro da VM: ambiente, apt e Chromium.
pub fn apply(m: &Machine) -> Result<()> {
    let on = !m.net_allow.is_empty();
    let mut sc = String::from("set -e\nsudo sed -i '/# hyzevm-net begin/,/# hyzevm-net end/d' /etc/environment\n");
    if on {
        sc += &format!("{{ echo '# hyzevm-net begin'; for v in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY; do echo \"$v=\\\"{GUEST_PROXY}\\\"\"; done; echo 'no_proxy=\"localhost,127.0.0.1\"'; echo '# hyzevm-net end'; }} | sudo tee -a /etc/environment >/dev/null\n\
            echo {GUEST_PROXY} | sudo tee /etc/hyze-proxy >/dev/null\n\
            echo 'Acquire::http::Proxy \"{GUEST_PROXY}\";' | sudo tee /etc/apt/apt.conf.d/99hyze-proxy >/dev/null\n");
    } else {
        sc += "sudo rm -f /etc/hyze-proxy /etc/apt/apt.conf.d/99hyze-proxy\n";
    }
    sc += &format!("echo {} | base64 -d | sudo tee /usr/local/bin/hyze-chromium >/dev/null; sudo chmod 755 /usr/local/bin/hyze-chromium\n",
        ssh::sh_quote(&base64::Engine::encode(&base64::engine::general_purpose::STANDARD, include_str!("hyze-chromium.sh"))));
    let o = ssh::exec_stdin(m, &sc)?;
    if !o.status.success() { bail!("não consegui configurar o proxy na máquina: {}", String::from_utf8_lossy(&o.stderr).trim()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{allowed, is_public};
    #[test]
    fn only_public_addresses_are_reachable() {
        let no = ["127.0.0.1", "10.0.2.2", "192.168.1.5", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
            "255.255.255.255", "::1", "::", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "64:ff9b::7f00:1", "2002:7f00:1::", "ff02::1"];
        let yes = ["1.1.1.1", "93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8"];
        for a in no { assert!(!is_public(a.parse().unwrap()), "{a} deveria ser bloqueado"); }
        for a in yes { assert!(is_public(a.parse().unwrap()), "{a} deveria ser liberado"); }
    }
    fn l(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }
    #[test]
    fn allow_list_matches_domain_and_subdomains_only() {
        let a = l(&["instagram.com", "*.cdninstagram.com"]);
        assert!(allowed(&a, "instagram.com"));
        assert!(allowed(&a, "www.instagram.com"));
        assert!(allowed(&a, "scontent.cdninstagram.com"));
        assert!(allowed(&a, "Instagram.COM."));
        assert!(!allowed(&a, "evilinstagram.com"));
        assert!(!allowed(&a, "instagram.com.evil.io"));
        assert!(allowed(&l(&["*"]), "qualquer.coisa"));
        assert!(!allowed(&[], "example.com"));
    }
}
