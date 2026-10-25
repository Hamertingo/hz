//! "Teach a task": the agent studies a recording of the reader doing something, then writes itself a guide.

use std::path::{Path, PathBuf};

/// The instruction sent with a lesson recording, so the agent reads the frames and writes a guide plus a memory line.
pub fn build_teach_prompt(recording_path: &str, frame_count: usize) -> String {
    format!(
        "The reader just showed you how to do a task and recorded their screen at {recording_path}. \
         {frame_count} frames from the recording are attached, in order. \
         Study them one by one and work out what the reader did and why. \
         Then write a step-by-step guide in your skills folder: the goal, what you need before you start, \
         numbered steps with the exact places to click or type, and what done looks like. \
         Add one line to your memory that points to the guide. \
         Never copy passwords, codes or private details seen in the frames into the guide. \
         When the guide is saved, tell the reader its title and ask if any step is unclear."
    )
}

/// Evenly spaced timestamps in seconds, one per slice of the video, at most one per second.
pub fn frame_times(duration_secs: f64, max_frames: usize) -> Vec<f64> {
    if !duration_secs.is_finite() || duration_secs <= 0.0 || max_frames == 0 {
        return vec![];
    }
    let n = max_frames.min(duration_secs.ceil() as usize).max(1);
    (0..n)
        .map(|i| {
            let t = duration_secs * (i as f64 + 0.5) / n as f64;
            (t * 1000.0).round() / 1000.0
        })
        .collect()
}

/// Arguments for one `ffmpeg` call that writes a JPEG per timestamp as `frame_001.jpg`, `frame_002.jpg`, ...
pub fn ffmpeg_args(video: &str, out_dir: &str, times: &[f64]) -> Vec<String> {
    let mut a: Vec<String> = ["-y", "-loglevel", "error"].iter().map(|s| s.to_string()).collect();
    for t in times {
        a.extend(["-ss".into(), format!("{t:.3}"), "-i".into(), video.into()]);
    }
    for i in 0..times.len() {
        let out = Path::new(out_dir).join(format!("frame_{:03}.jpg", i + 1));
        a.extend([
            "-map".into(),
            format!("{i}:v:0"),
            "-frames:v".into(),
            "1".into(),
            "-q:v".into(),
            "3".into(),
            out.to_string_lossy().into_owned(),
        ]);
    }
    a
}

fn slug(title: &str) -> String {
    let mut s = String::new();
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c.to_ascii_lowercase());
        } else if !s.ends_with('-') {
            s.push('-');
        }
    }
    let s: String = s.trim_matches('-').chars().take(60).collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "task".into() } else { s }
}

/// Where a guide is saved: `<folder>/skills/<slug>.md`; the title can never climb out of that folder.
pub fn guide_path(folder: &Path, task_title: &str) -> PathBuf {
    folder.join("skills").join(format!("{}.md", slug(task_title)))
}

/// One memory line that points to a guide, always on a single line.
pub fn memory_line(title: &str, path: &Path) -> String {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("- How to {title}: read {} before doing it", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_names_path_and_count() {
        let p = build_teach_prompt("/tmp/a.mov", 8);
        assert!(p.contains("/tmp/a.mov") && p.contains("8 frames"));
        assert!(p.contains("memory"));
    }

    #[test]
    fn times_are_even_and_inside() {
        let t = frame_times(10.0, 5);
        assert_eq!(t, vec![1.0, 3.0, 5.0, 7.0, 9.0]);
    }

    #[test]
    fn short_video_gets_fewer_frames() {
        assert_eq!(frame_times(2.0, 12).len(), 2);
        assert_eq!(frame_times(0.4, 12).len(), 1);
    }

    #[test]
    fn bad_durations_give_nothing() {
        assert!(frame_times(0.0, 5).is_empty());
        assert!(frame_times(-3.0, 5).is_empty());
        assert!(frame_times(f64::NAN, 5).is_empty());
        assert!(frame_times(10.0, 0).is_empty());
    }

    #[test]
    fn times_never_exceed_duration() {
        for t in frame_times(7.3, 20) {
            assert!(t > 0.0 && t < 7.3);
        }
    }

    #[test]
    fn ffmpeg_args_shape() {
        let a = ffmpeg_args("in.mp4", "/o", &[1.0, 2.5]);
        assert_eq!(a.iter().filter(|x| *x == "-i").count(), 2);
        assert!(a.contains(&"1:v:0".to_string()));
        assert!(a.contains(&"/o/frame_002.jpg".to_string()));
        assert_eq!(a[0], "-y");
    }

    #[test]
    fn slug_is_safe() {
        let p = guide_path(Path::new("/w/agent"), "../../etc/passwd");
        assert_eq!(p, PathBuf::from("/w/agent/skills/etc-passwd.md"));
        assert_eq!(guide_path(Path::new("/w"), "Post a Video!").file_name().unwrap(), "post-a-video.md");
    }

    #[test]
    fn empty_or_symbol_title_falls_back() {
        assert_eq!(guide_path(Path::new("/w"), "???").file_name().unwrap(), "task.md");
        assert_eq!(guide_path(Path::new("/w"), "").file_name().unwrap(), "task.md");
    }

    #[test]
    fn long_title_is_capped() {
        let p = guide_path(Path::new("/w"), &"a".repeat(200));
        assert!(p.file_name().unwrap().len() <= 63);
    }

    #[test]
    fn memory_line_is_one_line() {
        let l = memory_line("file a\ntax form", Path::new("/w/skills/x.md"));
        assert!(!l.contains('\n'));
        assert!(l.contains("/w/skills/x.md") && l.contains("file a tax form"));
    }
}
