//! The agents' Linux computer: Lima on macOS and Linux, a WSL distro on Windows. Builders, parsers and the wake logic live
//! here; every process goes through `Runner` so tests never start one.

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Lima instance and WSL distro name.
pub const INSTANCE: &str = "hz-computer";

/// Lifecycle of the machine as the app sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VmState {
    Absent,
    Stopped,
    Starting,
    Running,
    Stopping,
}

/// How much of the host the computer may use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Size {
    Small,
    Medium,
    Large,
}

impl Size {
    /// Virtual CPUs: 2, 4 or 8.
    pub fn cpus(self) -> u32 {
        match self {
            Size::Small => 2,
            Size::Medium => 4,
            Size::Large => 8,
        }
    }

    /// Memory in GB: 4, 8 or 16.
    pub fn memory_gb(self) -> u32 {
        match self {
            Size::Small => 4,
            Size::Medium => 8,
            Size::Large => 16,
        }
    }
}

fn map_status(s: &str) -> VmState {
    match s.to_ascii_lowercase().as_str() {
        "running" => VmState::Running,
        "starting" | "creating" | "provisioning" => VmState::Starting,
        "stopping" => VmState::Stopping,
        _ => VmState::Stopped,
    }
}

/// State of our instance from `limactl list --json` (one JSON object per line); no matching line means Absent.
pub fn parse_limactl_list(json_lines: &str) -> VmState {
    for line in json_lines.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        if v.get("name").and_then(|n| n.as_str()) == Some(INSTANCE) {
            return map_status(v.get("status").and_then(|s| s.as_str()).unwrap_or(""));
        }
    }
    VmState::Absent
}

/// State of our distro from `wsl -l -v`; the tool prints UTF-16, so NULs are dropped before reading.
pub fn parse_wsl_list(text: &str) -> VmState {
    let clean: String = text.chars().filter(|c| *c != '\0').collect();
    for line in clean.lines() {
        let cols: Vec<&str> = line.trim_start_matches('*').split_whitespace().collect();
        if cols.first() == Some(&INSTANCE) {
            return map_status(cols.get(1).copied().unwrap_or(""));
        }
    }
    VmState::Absent
}

/// Argument lists for `limactl`; the program name is not part of them.
pub struct LimaCmd;

impl LimaCmd {
    /// Creates the instance from a yaml template.
    pub fn create(yaml_path: &str) -> Vec<String> {
        ["create", "--tty=false", &format!("--name={INSTANCE}"), yaml_path].map(String::from).to_vec()
    }

    /// Boots the instance.
    pub fn start() -> Vec<String> {
        ["start", "--tty=false", INSTANCE].map(String::from).to_vec()
    }

    /// Stops the instance, keeping its disk.
    pub fn stop() -> Vec<String> {
        ["stop", INSTANCE].map(String::from).to_vec()
    }

    /// Runs `command` through a login shell in `/workspace`; the command is one argument, so nothing needs quoting.
    pub fn shell(command: &str) -> Vec<String> {
        ["shell", "--workdir", "/workspace", INSTANCE, "--", "bash", "-lc", command].map(String::from).to_vec()
    }

    /// Removes the instance and its disk.
    pub fn delete() -> Vec<String> {
        ["delete", "--force", INSTANCE].map(String::from).to_vec()
    }

    /// Changes CPU and memory; takes effect at the next start.
    pub fn set_resources(size: Size) -> Vec<String> {
        vec![
            "edit".into(),
            "--tty=false".into(),
            format!("--cpus={}", size.cpus()),
            format!("--memory={}", size.memory_gb()),
            INSTANCE.into(),
        ]
    }

    /// Lists instances as JSON lines.
    pub fn list() -> Vec<String> {
        ["list", "--json"].map(String::from).to_vec()
    }
}

/// Argument lists for `wsl.exe`.
pub struct WslCmd;

impl WslCmd {
    /// Runs `command` in the distro.
    pub fn shell(command: &str) -> Vec<String> {
        ["-d", INSTANCE, "--cd", "/workspace", "--", "bash", "-lc", command].map(String::from).to_vec()
    }

    /// Stops the distro.
    pub fn stop() -> Vec<String> {
        ["--terminate", INSTANCE].map(String::from).to_vec()
    }

    /// Removes the distro.
    pub fn delete() -> Vec<String> {
        ["--unregister", INSTANCE].map(String::from).to_vec()
    }

    /// Lists distros with their state.
    pub fn list() -> Vec<String> {
        ["-l", "-v"].map(String::from).to_vec()
    }
}

/// When the machine should be put to sleep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdlePolicy {
    pub sleep_after: chrono::Duration,
}

impl Default for IdlePolicy {
    fn default() -> Self {
        Self { sleep_after: chrono::Duration::minutes(20) }
    }
}

impl IdlePolicy {
    /// True once nobody has used the computer for `sleep_after` and no agent is mid-task on it.
    pub fn should_sleep(&self, last_used: DateTime<Utc>, now: DateTime<Utc>, any_agent_working: bool) -> bool {
        !any_agent_working && now.signed_duration_since(last_used) >= self.sleep_after
    }
}

/// What a finished command left behind.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Output {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Runs an external program; the real one spawns it, tests use a fake.
pub trait Runner {
    /// Runs `program args...` and waits for it.
    fn run(&self, program: &str, args: &[String]) -> anyhow::Result<Output>;
    /// Waits between polls; fakes make this a no-op.
    fn sleep(&self, d: Duration) {
        std::thread::sleep(d);
    }
}

/// Spawns real processes. Blocking: call from `spawn_blocking`.
pub struct SystemRunner;

impl Runner for SystemRunner {
    fn run(&self, program: &str, args: &[String]) -> anyhow::Result<Output> {
        let out = std::process::Command::new(program).args(args).output()?;
        Ok(Output {
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }
}

/// Reads the machine's state through `limactl list`.
pub fn lima_state(runner: &dyn Runner) -> anyhow::Result<VmState> {
    let out = runner.run("limactl", &LimaCmd::list())?;
    Ok(parse_limactl_list(&out.stdout))
}

/// Brings the machine to Running: starts it if stopped, waits out a start in progress (up to `max_polls` looks).
pub fn wake_if_needed(runner: &dyn Runner, max_polls: u32) -> anyhow::Result<VmState> {
    let mut state = lima_state(runner)?;
    if state == VmState::Absent {
        anyhow::bail!("the computer has not been created yet");
    }
    if state == VmState::Stopped {
        let out = runner.run("limactl", &LimaCmd::start())?;
        if out.code != 0 {
            anyhow::bail!("the computer did not start: {}", out.stderr.trim());
        }
        state = lima_state(runner)?;
    }
    let mut polls = 0;
    while matches!(state, VmState::Starting | VmState::Stopping) {
        if polls >= max_polls {
            anyhow::bail!("the computer is still {state:?} after {max_polls} checks");
        }
        polls += 1;
        runner.sleep(Duration::from_secs(2));
        state = lima_state(runner)?;
        if state == VmState::Stopped {
            runner.run("limactl", &LimaCmd::start())?;
            state = lima_state(runner)?;
        }
    }
    if state != VmState::Running {
        anyhow::bail!("the computer is {state:?}, not running");
    }
    Ok(state)
}

/// What the shell tool runs commands on.
pub trait Computer {
    /// Runs `cmd` for `agent`, waiting first if the user holds the agent's screen.
    fn exec(&self, agent: &str, cmd: &str) -> anyhow::Result<Output>;
}

/// The Lima-backed computer. `screen_for` maps an agent to its screen so commands land on the right display.
pub struct LimaComputer<'a> {
    pub runner: &'a dyn Runner,
    pub is_taken: &'a dyn Fn() -> bool,
    pub screen_for: &'a dyn Fn(&str) -> u32,
    pub max_wait: Duration,
    pub poll: Duration,
}

impl Computer for LimaComputer<'_> {
    fn exec(&self, agent: &str, cmd: &str) -> anyhow::Result<Output> {
        let mut waited = Duration::ZERO;
        while (self.is_taken)() {
            if waited >= self.max_wait {
                anyhow::bail!("you are in control of this screen; the command was not run");
            }
            self.runner.sleep(self.poll);
            waited += self.poll;
        }
        wake_if_needed(self.runner, 30)?;
        let display = super::screens::display_for((self.screen_for)(agent));
        let full = format!("export DISPLAY={display}; {cmd}");
        self.runner.run("limactl", &LimaCmd::shell(&full))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;

    struct Fake {
        list: RefCell<VecDeque<String>>,
        calls: RefCell<Vec<Vec<String>>>,
        start_code: i32,
        slept: Cell<u32>,
    }
    impl Fake {
        fn new(lists: &[&str]) -> Self {
            Self {
                list: RefCell::new(lists.iter().map(|s| s.to_string()).collect()),
                calls: RefCell::new(vec![]),
                start_code: 0,
                slept: Cell::new(0),
            }
        }
        fn row(status: &str) -> String {
            format!(r#"{{"name":"hz-computer","status":"{status}"}}"#)
        }
    }
    impl Runner for Fake {
        fn run(&self, _p: &str, args: &[String]) -> anyhow::Result<Output> {
            self.calls.borrow_mut().push(args.to_vec());
            if args[0] == "list" {
                let mut l = self.list.borrow_mut();
                let s = if l.len() > 1 { l.pop_front().unwrap() } else { l.front().cloned().unwrap_or_default() };
                return Ok(Output { stdout: s, ..Default::default() });
            }
            if args[0] == "start" {
                return Ok(Output { code: self.start_code, stderr: "boom".into(), ..Default::default() });
            }
            Ok(Output { stdout: "ok".into(), ..Default::default() })
        }
        fn sleep(&self, _d: Duration) {
            self.slept.set(self.slept.get() + 1);
        }
    }
    fn t(m: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap() + chrono::Duration::minutes(m)
    }

    #[test]
    fn parses_each_status() {
        assert_eq!(parse_limactl_list(&Fake::row("Running")), VmState::Running);
        assert_eq!(parse_limactl_list(&Fake::row("Stopped")), VmState::Stopped);
        assert_eq!(parse_limactl_list(&Fake::row("Starting")), VmState::Starting);
        assert_eq!(parse_limactl_list(&Fake::row("Stopping")), VmState::Stopping);
    }

    #[test]
    fn list_ignores_other_instances_and_noise() {
        let text = format!("garbage\n{{\"name\":\"default\",\"status\":\"Running\"}}\n{}\n", Fake::row("Stopped"));
        assert_eq!(parse_limactl_list(&text), VmState::Stopped);
        assert_eq!(parse_limactl_list(""), VmState::Absent);
        assert_eq!(parse_limactl_list("{\"name\":\"default\",\"status\":\"Running\"}"), VmState::Absent);
    }

    #[test]
    fn parses_wsl_utf16_leftovers() {
        let text = "  NAME\0 STATE\0\n* h\0z-computer Running 2\n";
        assert_eq!(parse_wsl_list("  NAME STATE VERSION\n* hz-computer   Running   2\n  Ubuntu Stopped 2"), VmState::Running);
        assert_eq!(parse_wsl_list("  Ubuntu Stopped 2"), VmState::Absent);
        assert_eq!(parse_wsl_list(text), VmState::Running);
    }

    #[test]
    fn sizes() {
        assert_eq!((Size::Small.cpus(), Size::Small.memory_gb()), (2, 4));
        assert_eq!((Size::Medium.cpus(), Size::Medium.memory_gb()), (4, 8));
        assert_eq!((Size::Large.cpus(), Size::Large.memory_gb()), (8, 16));
    }

    #[test]
    fn builders() {
        assert_eq!(LimaCmd::create("/y.yaml"), vec!["create", "--tty=false", "--name=hz-computer", "/y.yaml"]);
        assert_eq!(LimaCmd::start().last().unwrap(), INSTANCE);
        assert_eq!(LimaCmd::stop(), vec!["stop", INSTANCE]);
        assert_eq!(LimaCmd::delete(), vec!["delete", "--force", INSTANCE]);
        assert_eq!(
            LimaCmd::set_resources(Size::Medium),
            vec!["edit", "--tty=false", "--cpus=4", "--memory=8", INSTANCE]
        );
    }

    #[test]
    fn shell_keeps_command_as_one_argument() {
        let a = LimaCmd::shell("echo 'a b'; ls | wc -l");
        assert_eq!(a.last().unwrap(), "echo 'a b'; ls | wc -l");
        assert_eq!(a[a.len() - 3], "bash");
        assert!(WslCmd::shell("x").contains(&"x".to_string()));
        assert_eq!(WslCmd::stop(), vec!["--terminate", INSTANCE]);
    }

    #[test]
    fn idle_policy() {
        let p = IdlePolicy::default();
        assert!(!p.should_sleep(t(0), t(19), false));
        assert!(p.should_sleep(t(0), t(20), false));
        assert!(!p.should_sleep(t(0), t(500), true));
    }

    #[test]
    fn wake_noop_when_running() {
        let f = Fake::new(&[&Fake::row("Running")]);
        assert_eq!(wake_if_needed(&f, 3).unwrap(), VmState::Running);
        assert!(f.calls.borrow().iter().all(|c| c[0] == "list"));
    }

    #[test]
    fn wake_starts_when_stopped() {
        let f = Fake::new(&[&Fake::row("Stopped"), &Fake::row("Running")]);
        assert_eq!(wake_if_needed(&f, 3).unwrap(), VmState::Running);
        assert!(f.calls.borrow().iter().any(|c| c[0] == "start"));
    }

    #[test]
    fn wake_waits_out_starting_then_gives_up() {
        let f = Fake::new(&[&Fake::row("Starting")]);
        assert!(wake_if_needed(&f, 2).unwrap_err().to_string().contains("still"));
        assert_eq!(f.slept.get(), 2);
        let g = Fake::new(&[&Fake::row("Starting"), &Fake::row("Starting"), &Fake::row("Running")]);
        assert_eq!(wake_if_needed(&g, 5).unwrap(), VmState::Running);
    }

    #[test]
    fn wake_errors_when_absent_or_start_fails() {
        assert!(wake_if_needed(&Fake::new(&[""]), 1).is_err());
        let mut f = Fake::new(&[&Fake::row("Stopped")]);
        f.start_code = 1;
        assert!(wake_if_needed(&f, 1).unwrap_err().to_string().contains("boom"));
    }

    fn computer<'a>(f: &'a Fake, taken: &'a dyn Fn() -> bool) -> LimaComputer<'a> {
        LimaComputer {
            runner: f,
            is_taken: taken,
            screen_for: &|_| 2,
            max_wait: Duration::from_secs(10),
            poll: Duration::from_secs(1),
        }
    }

    #[test]
    fn exec_sets_display_and_runs_shell() {
        let f = Fake::new(&[&Fake::row("Running")]);
        let out = computer(&f, &|| false).exec("ana", "firefox").unwrap();
        assert_eq!(out.stdout, "ok");
        let calls = f.calls.borrow();
        let last = calls.last().unwrap();
        assert_eq!(last[0], "shell");
        assert_eq!(last.last().unwrap(), "export DISPLAY=:102; firefox");
    }

    #[test]
    fn exec_waits_for_hand_back() {
        let f = Fake::new(&[&Fake::row("Running")]);
        let n = Cell::new(0);
        let taken = || {
            n.set(n.get() + 1);
            n.get() <= 3
        };
        computer(&f, &taken).exec("ana", "ls").unwrap();
        assert_eq!(f.slept.get(), 3);
    }

    #[test]
    fn exec_refuses_when_control_never_returns() {
        let f = Fake::new(&[&Fake::row("Running")]);
        let err = computer(&f, &|| true).exec("ana", "ls").unwrap_err();
        assert!(err.to_string().contains("in control"));
        assert!(f.calls.borrow().is_empty());
    }
}
