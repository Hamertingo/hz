//! Spawning a child without giving it a window of its own.
//!
//! On Windows a console program started by one that has no console — which is
//! every GUI app, this one included — gets a **new console allocated for it**,
//! and that console is a visible window for as long as the child runs. `git`,
//! `gh` and the agent itself are all console programs, so an app that spawns
//! them the obvious way flashes a black window per spawn: attaching a project
//! was a screenful of them, each titled `hz-agent` because that is the agent's
//! own process title.
//!
//! `CREATE_NO_WINDOW` is the flag that says "no console", and it has to be set
//! on the spawn rather than inherited — a child with no console of its own does
//! not pass one on. So every spawn in this crate goes through [`HideConsole`],
//! which is the one statement of it; a new `Command::new` that forgets it is a
//! window on somebody's screen.
//!
//! Nothing to do elsewhere: a unix child has no console to be given.

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Hide the console a spawned child would otherwise get on Windows.
///
/// A no-op everywhere else, so it is applied unconditionally rather than at the
/// call sites that happen to be Windows-reachable today.
pub trait HideConsole {
    /// Mark this child as running with no window.
    fn hide_console(self) -> Self;
}

impl HideConsole for tokio::process::Command {
    fn hide_console(self) -> Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let mut this = self;
            this.as_std_mut().creation_flags(CREATE_NO_WINDOW);
            this
        }
        #[cfg(not(windows))]
        {
            self
        }
    }
}

impl HideConsole for std::process::Command {
    fn hide_console(self) -> Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let mut this = self;
            this.creation_flags(CREATE_NO_WINDOW);
            this
        }
        #[cfg(not(windows))]
        {
            self
        }
    }
}
