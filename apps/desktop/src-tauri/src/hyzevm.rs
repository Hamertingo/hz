//! The agents' computers, run by the HyzeVM this app carries (`apps/hyzevm`): one Debian machine per agent,
//! with a desktop to watch and take over. The app drives its CLI, and the QEMU it needs travels with it, so
//! nothing has to be installed first. The library is `~/.hyzevm`, shared with a standalone HyzeVM on purpose:
//! the machines the reader already has stay visible, and ours are told apart by the `hz-` prefix.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use serde::Deserialize;

/// What a `hyzevm` run answered.
#[derive(Debug, Default, Clone)]
pub struct Out {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

/// Runs `hyzevm` with arguments; a trait so the logic below is tested without a machine.
pub trait Cli {
    fn run(&self, args: &[String]) -> Result<Out>;
    /// Waits between polls; a no-op in tests.
    fn sleep(&self, d: Duration) {
        std::thread::sleep(d);
    }
}

/// The real CLI: the copy shipped in the app, with the QEMU beside it.
pub struct Bundled;

impl Cli for Bundled {
    fn run(&self, args: &[String]) -> Result<Out> {
        let (bin, qemu) = locate()?;
        let mut cmd = Command::new(bin);
        cmd.args(args).stdin(Stdio::null()).env("NO_COLOR", "1");
        if let Some(q) = qemu {
            cmd.env("HYZEVM_QEMU_DIR", q);
        }
        let o = cmd.output().context("could not run hyzevm")?;
        Ok(Out { code: o.status.code().unwrap_or(-1), stdout: o.stdout, stderr: String::from_utf8_lossy(&o.stderr).into_owned() })
    }
}

/// `hyzevm` and the QEMU folder to hand it. The shipped copy leads; a `hyzevm` on the machine is the fallback for a
/// checkout that has not run `scripts/vendor-hyzevm.sh`, and it uses whatever QEMU the machine has.
fn locate() -> Result<(PathBuf, Option<PathBuf>)> {
    if let Some(dir) = crate::binpath::shipped_hyzevm() {
        return Ok((dir.join("bin").join(if cfg!(windows) { "hyzevm.exe" } else { "hyzevm" }), Some(dir.join("qemu"))));
    }
    let exe = if cfg!(windows) { "hyzevm.exe" } else { "hyzevm" };
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".cargo/bin"));
    }
    dirs.into_iter()
        .map(|d| d.join(exe))
        .find(|p| p.is_file())
        .map(|p| (p, None))
        .context("The computer's engine is missing from this build. Run scripts/vendor-hyzevm.sh and build again.")
}

/// A machine as `hyzevm get --json` and `ls --json` describe it.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Machine {
    pub name: String,
    /// `running`, `paused` or `stopped`.
    pub state: String,
    #[serde(default)]
    pub view: Option<String>,
    #[serde(default)]
    pub cpus: u32,
    #[serde(default)]
    pub memory_mb: u32,
}

/// The machine name of an agent: `hz-` and its id, kept to what HyzeVM accepts (letters, digits, `-`, `_`).
pub fn machine_name(agent: &str) -> String {
    let id: String = agent.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(40).collect();
    format!("hz-{id}")
}

/// How much machine an agent's computer gets: CPUs and memory in MB.
pub fn size_spec(size: &str) -> Option<(u32, u32)> {
    match size {
        "small" => Some((2, 2048)),
        "medium" => Some((4, 4096)),
        "large" => Some((8, 8192)),
        _ => None,
    }
}

fn args(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

/// The agent's machine, or `None` when it has none yet.
pub fn get(cli: &dyn Cli, agent: &str) -> Result<Option<Machine>> {
    let out = cli.run(&args(&["get", &machine_name(agent), "--json"]))?;
    if out.code != 0 {
        if out.stderr.contains("não existe") || out.stderr.contains("does not exist") {
            return Ok(None);
        }
        bail!("{}", out.stderr.trim());
    }
    Ok(Some(serde_json::from_slice(&out.stdout).context("hyzevm answered something unreadable")?))
}

/// The word the webview uses: `absent`, `stopped` (off or paused, both wake on demand) or `running`.
pub fn state(cli: &dyn Cli, agent: &str) -> &'static str {
    match get(cli, agent) {
        Ok(Some(m)) if m.state == "running" => "running",
        Ok(Some(_)) => "stopped",
        _ => "absent",
    }
}

/// Turns the computer on: creates it from the desktop template the first time (about a minute while the image is
/// built, ten seconds after), starts or resumes it otherwise.
pub fn start(cli: &dyn Cli, agent: &str, size: &str) -> Result<()> {
    let name = machine_name(agent);
    let out = match get(cli, agent)? {
        Some(m) if m.state == "running" => return Ok(()),
        Some(_) => cli.run(&args(&["start", &name]))?,
        None => {
            let (cpus, mem) = size_spec(size).unwrap_or((2, 2048));
            cli.run(&args(&["create", &name, "--template", "desktop", "--cpus", &cpus.to_string(), "--memory-mb", &mem.to_string()]))?
        }
    };
    if out.code != 0 {
        bail!("{}", out.stderr.trim());
    }
    Ok(())
}

/// Makes sure the agent has a computer and leaves it asleep: created from the template if it has none (it boots to
/// make it), then paused. A computer that exists is left exactly as it is, running or asleep.
pub fn ensure(cli: &dyn Cli, agent: &str, size: &str) -> Result<()> {
    if get(cli, agent)?.is_some() {
        return Ok(());
    }
    start(cli, agent, size)?;
    pause(cli, agent)
}

/// Pauses the computer: no CPU, and it wakes in under a second. A machine that does not exist is already off.
pub fn pause(cli: &dyn Cli, agent: &str) -> Result<()> {
    if get(cli, agent)?.is_none() {
        return Ok(());
    }
    let out = cli.run(&args(&["pause", &machine_name(agent)]))?;
    if out.code != 0 {
        bail!("the computer did not pause: {}", out.stderr.trim());
    }
    Ok(())
}

/// Shuts the computer down; a machine that does not exist is already off.
pub fn stop(cli: &dyn Cli, agent: &str) -> Result<()> {
    if get(cli, agent)?.is_none() {
        return Ok(());
    }
    let out = cli.run(&args(&["stop", &machine_name(agent)]))?;
    if out.code != 0 {
        bail!("the computer did not stop: {}", out.stderr.trim());
    }
    Ok(())
}

/// Changes the size of an existing computer, which HyzeVM only does while it is off.
pub fn resize(cli: &dyn Cli, agent: &str, size: &str) -> Result<()> {
    let Some((cpus, mem)) = size_spec(size) else { bail!("unknown size") };
    let Some(m) = get(cli, agent)? else { return Ok(()) };
    if m.state != "stopped" {
        stop(cli, agent)?;
    }
    let out = cli.run(&args(&["resize", &m.name, "--cpus", &cpus.to_string(), "--memory-mb", &mem.to_string()]))?;
    if out.code != 0 {
        bail!("{}", out.stderr.trim());
    }
    Ok(())
}

/// The web address of the agent's screen bridge, waking the computer first. Waits until the desktop answers on it,
/// since a machine that just booted reports running a few seconds before its screen does.
pub fn screen_base(cli: &dyn Cli, agent: &str, size: &str, ready: &dyn Fn(u16) -> bool) -> Result<String> {
    start(cli, agent, size)?;
    let started = Instant::now();
    loop {
        let m = get(cli, agent)?.context("the computer is gone")?;
        let port = m.view.as_deref().and_then(port_of);
        if let Some(p) = port {
            if ready(p) {
                return Ok(format!("http://127.0.0.1:{p}"));
            }
        }
        if started.elapsed() > Duration::from_secs(60) {
            bail!("the screen did not come up in time");
        }
        cli.sleep(Duration::from_millis(500));
    }
}

/// The port in `http://127.0.0.1:PORT/vnc.html?...`.
fn port_of(view: &str) -> Option<u16> {
    let rest = view.strip_prefix("http://127.0.0.1:")?;
    rest.split(['/', '?']).next()?.parse().ok()
}

/// A picture of the agent's screen, as PNG bytes.
pub fn screenshot(cli: &dyn Cli, agent: &str) -> Result<Vec<u8>> {
    if state(cli, agent) != "running" {
        bail!("the computer is off; turn it on first");
    }
    let dir = std::env::temp_dir().join(format!("hz-shot-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir)?;
    let file = dir.join("screen.png");
    let out = cli.run(&args(&["desktop", "screenshot", &machine_name(agent), "-o", &file.to_string_lossy()]));
    let bytes = out.and_then(|o| if o.code == 0 { std::fs::read(&file).context("no picture was written") } else { bail!("{}", o.stderr.trim()) });
    let _ = std::fs::remove_dir_all(&dir);
    bytes
}

/// True when something accepts a connection on the loopback port.
pub fn port_open(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(400)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Fake {
        state: RefCell<Option<&'static str>>,
        calls: RefCell<Vec<Vec<String>>>,
        port: u16,
    }
    impl Fake {
        fn new(state: Option<&'static str>) -> Self {
            Self { state: RefCell::new(state), calls: RefCell::new(vec![]), port: 51653 }
        }
        fn verbs(&self) -> Vec<String> {
            self.calls.borrow().iter().map(|c| c[0].clone()).collect()
        }
    }
    impl Cli for Fake {
        fn run(&self, a: &[String]) -> Result<Out> {
            self.calls.borrow_mut().push(a.to_vec());
            let mut out = Out::default();
            match a[0].as_str() {
                "get" => match *self.state.borrow() {
                    None => {
                        out.code = 1;
                        out.stderr = "erro: máquina “x” não existe".into();
                    }
                    Some(s) => {
                        out.stdout = format!(
                            r#"{{"name":"{}","state":"{}","cpus":2,"memory_mb":2048,"view":"http://127.0.0.1:{}/vnc.html?autoconnect=1"}}"#,
                            a[1], s, self.port
                        )
                        .into_bytes()
                    }
                },
                "create" | "start" => *self.state.borrow_mut() = Some("running"),
                "pause" => *self.state.borrow_mut() = Some("paused"),
                "stop" => *self.state.borrow_mut() = Some("stopped"),
                _ => {}
            }
            Ok(out)
        }
        fn sleep(&self, _d: Duration) {}
    }

    #[test]
    fn a_name_is_the_agent_id_kept_to_what_hyzevm_accepts() {
        assert_eq!(machine_name("a1"), "hz-a1");
        assert_eq!(machine_name("mila rose/2"), "hz-mila-rose-2");
        assert!(machine_name(&"x".repeat(80)).len() <= 43);
    }

    #[test]
    fn sizes_are_cpus_and_memory() {
        assert_eq!(size_spec("small"), Some((2, 2048)));
        assert_eq!(size_spec("large"), Some((8, 8192)));
        assert_eq!(size_spec("huge"), None);
    }

    #[test]
    fn a_missing_machine_is_absent_and_quiet_to_stop() {
        let cli = Fake::new(None);
        assert_eq!(state(&cli, "a1"), "absent");
        stop(&cli, "a1").unwrap();
        pause(&cli, "a1").unwrap();
        resize(&cli, "a1", "large").unwrap();
        assert!(!cli.verbs().iter().any(|v| v == "stop" || v == "pause" || v == "resize"));
    }

    #[test]
    fn the_first_start_creates_it_from_the_desktop_template_at_the_chosen_size() {
        let cli = Fake::new(None);
        start(&cli, "a1", "medium").unwrap();
        let create = cli.calls.borrow().iter().find(|c| c[0] == "create").unwrap().clone();
        assert!(create.windows(2).any(|w| w == ["--template", "desktop"]));
        assert!(create.windows(2).any(|w| w == ["--cpus", "4"]) && create.windows(2).any(|w| w == ["--memory-mb", "4096"]));
        assert_eq!(state(&cli, "a1"), "running");
    }

    #[test]
    fn ensure_creates_a_missing_machine_and_leaves_it_asleep() {
        let cli = Fake::new(None);
        ensure(&cli, "a1", "small").unwrap();
        assert_eq!(cli.verbs().iter().filter(|v| *v == "create").count(), 1);
        assert_eq!(get(&cli, "a1").unwrap().unwrap().state, "paused");
    }

    #[test]
    fn ensure_leaves_an_existing_machine_alone() {
        let cli = Fake::new(Some("running"));
        ensure(&cli, "a1", "small").unwrap();
        assert!(!cli.verbs().iter().any(|v| v == "create" || v == "pause" || v == "start"));
    }

    #[test]
    fn a_paused_machine_is_resumed_not_created_again() {
        let cli = Fake::new(Some("paused"));
        assert_eq!(state(&cli, "a1"), "stopped");
        start(&cli, "a1", "small").unwrap();
        assert!(cli.verbs().contains(&"start".to_string()) && !cli.verbs().contains(&"create".to_string()));
        start(&cli, "a1", "small").unwrap();
        assert_eq!(cli.verbs().iter().filter(|v| *v == "start").count(), 1);
    }

    #[test]
    fn resizing_stops_a_running_machine_first() {
        let cli = Fake::new(Some("running"));
        resize(&cli, "a1", "large").unwrap();
        let verbs = cli.verbs();
        assert!(verbs.iter().position(|v| v == "stop") < verbs.iter().position(|v| v == "resize"));
    }

    #[test]
    fn the_screen_address_waits_for_the_port_and_names_the_bridge() {
        let cli = Fake::new(Some("stopped"));
        let tries = RefCell::new(0);
        let ready = |p: u16| {
            *tries.borrow_mut() += 1;
            p == 51653 && *tries.borrow() >= 3
        };
        assert_eq!(screen_base(&cli, "a1", "small", &ready).unwrap(), "http://127.0.0.1:51653");
        assert_eq!(*tries.borrow(), 3);
    }

    #[test]
    fn the_port_comes_out_of_the_view_address() {
        assert_eq!(port_of("http://127.0.0.1:51653/vnc.html?autoconnect=1"), Some(51653));
        assert_eq!(port_of("http://example.com/vnc.html"), None);
    }

    #[test]
    fn a_screenshot_needs_a_running_machine() {
        let cli = Fake::new(Some("stopped"));
        assert!(screenshot(&cli, "a1").unwrap_err().to_string().contains("off"));
    }
}
