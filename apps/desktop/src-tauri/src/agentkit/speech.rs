//! Text prepared for a speech engine (English): numbers, money, dates and times become words, and markup, links, code and emoji drop out.

use regex::{Captures, Regex};

const ONES: [&str; 20] = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const MONTHS: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
    "December",
];

fn below_thousand(n: u64) -> String {
    let mut parts = vec![];
    if n >= 100 {
        parts.push(format!("{} hundred", ONES[(n / 100) as usize]));
    }
    let r = n % 100;
    if r >= 20 {
        let t = TENS[(r / 10) as usize];
        parts.push(if r.is_multiple_of(10) { t.to_string() } else { format!("{t}-{}", ONES[(r % 10) as usize]) });
    } else if r > 0 {
        parts.push(ONES[r as usize].to_string());
    }
    parts.join(" ")
}

/// A whole number in words, e.g. 1250 becomes "one thousand two hundred fifty".
pub fn number_to_words(n: u64) -> String {
    if n == 0 {
        return "zero".into();
    }
    let scales: [(u64, &str); 4] =
        [(1_000_000_000_000, "trillion"), (1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand")];
    let mut rest = n;
    let mut parts = vec![];
    for (size, name) in scales {
        if rest >= size {
            parts.push(format!("{} {name}", below_thousand(rest / size)));
            rest %= size;
        }
    }
    if rest > 0 {
        parts.push(below_thousand(rest));
    }
    parts.join(" ")
}

/// The ordinal form of a number, e.g. 21 becomes "twenty-first".
pub fn ordinal_words(n: u64) -> String {
    let cardinal = number_to_words(n);
    let split = cardinal.rfind([' ', '-']).map(|i| i + 1).unwrap_or(0);
    let (head, last) = cardinal.split_at(split);
    let ord = match last {
        "one" => "first".to_string(),
        "two" => "second".into(),
        "three" => "third".into(),
        "five" => "fifth".into(),
        "eight" => "eighth".into(),
        "nine" => "ninth".into(),
        "twelve" => "twelfth".into(),
        w if w.ends_with('y') => format!("{}ieth", &w[..w.len() - 1]),
        w => format!("{w}th"),
    };
    format!("{head}{ord}")
}

fn digits_to_words(digits: &str) -> String {
    digits.chars().filter_map(|c| c.to_digit(10)).map(|d| ONES[d as usize]).collect::<Vec<_>>().join(" ")
}

fn year_words(y: u64) -> String {
    let (hi, lo) = (y / 100, y % 100);
    match lo {
        0 => format!("{} hundred", number_to_words(hi)),
        1..=9 => format!("{} oh {}", number_to_words(hi), ONES[lo as usize]),
        _ => format!("{} {}", number_to_words(hi), number_to_words(lo)),
    }
}

fn plain_number(int_part: &str, frac: Option<&str>) -> String {
    let clean: String = int_part.chars().filter(|c| c.is_ascii_digit()).collect();
    let mut out = match clean.parse::<u64>() {
        Ok(n) if clean.len() <= 15 => number_to_words(n),
        _ => digits_to_words(&clean),
    };
    if let Some(f) = frac {
        out.push_str(" point ");
        out.push_str(&digits_to_words(f));
    }
    out
}

fn is_emoji(c: char) -> bool {
    matches!(c as u32,
        0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2B00..=0x2BFF | 0x2190..=0x21FF | 0xFE00..=0xFE0F | 0x200D | 0x20E3 | 0xE0020..=0xE007F)
}

struct Rules {
    fence: Regex,
    image: Regex,
    link: Regex,
    url: Regex,
    heading: Regex,
    bullet: Regex,
    quote: Regex,
    emphasis: Regex,
    underscore: Regex,
    iso_date: Regex,
    us_date: Regex,
    money: Regex,
    time: Regex,
    percent: Regex,
    ordinal: Regex,
    number: Regex,
}

impl Rules {
    fn new() -> Self {
        let r = |p: &str| Regex::new(p).expect("static pattern");
        Self {
            fence: r(r"(?s)```.*?(```|$)"),
            image: r(r"!\[([^\]]*)\]\([^)]*\)"),
            link: r(r"\[([^\]]+)\]\([^)]*\)"),
            url: r(r"(?i)\b(?:https?://|www\.)[^\s)>\]]+"),
            heading: r(r"(?m)^\s{0,3}#{1,6}\s*"),
            bullet: r(r"(?m)^\s*(?:[-*+•]|\d+[.)])\s+"),
            quote: r(r"(?m)^\s*>\s?"),
            emphasis: r(r"\*{1,3}|~~|`"),
            underscore: r(r"(^|[^A-Za-z0-9])_+|_+([^A-Za-z0-9]|$)"),
            iso_date: r(r"\b(\d{4})-(\d{2})-(\d{2})\b"),
            us_date: r(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b"),
            money: r(r"(?i)\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(k|m|b|thousand|million|billion)\b)?"),
            time: r(r"\b(\d{1,2}):(\d{2})(?::\d{2})?(?:\s?([AaPp])\.?[Mm]\.?)?"),
            percent: r(r"(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?%"),
            ordinal: r(r"(?i)\b(\d{1,6})(?:st|nd|rd|th)\b"),
            number: r(r"(^|[^\w.])(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?"),
        }
    }
}

fn date_words(month: usize, day: u64, year: u64) -> Option<String> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(format!("{} {}, {}", MONTHS[month - 1], ordinal_words(day), if (2000..=2009).contains(&year) { number_to_words(year) } else { year_words(year) }))
}

fn time_words(c: &Captures) -> Option<String> {
    let h: u64 = c[1].parse().ok()?;
    let m: u64 = c[2].parse().ok()?;
    if h > 24 || m > 59 {
        return None;
    }
    let given = c.get(3).map(|s| s.as_str().to_ascii_uppercase());
    let suffix = if h >= 13 || h == 12 && given.is_none() {
        Some("PM")
    } else if h == 0 {
        Some("AM")
    } else {
        match given.as_deref() {
            Some("A") => Some("AM"),
            Some("P") => Some("PM"),
            _ => None,
        }
    };
    let hour12 = if h.is_multiple_of(12) { 12 } else { h % 12 };
    let mut out = number_to_words(hour12);
    match (m, suffix) {
        (0, None) => out.push_str(" o'clock"),
        (0, Some(_)) => {}
        (1..=9, _) => out.push_str(&format!(" oh {}", ONES[m as usize])),
        _ => out.push_str(&format!(" {}", number_to_words(m))),
    }
    if let Some(s) = suffix {
        out.push(' ');
        out.push_str(s);
    }
    Some(out)
}

fn money_words(c: &Captures) -> String {
    let int_part = &c[1];
    let frac = c.get(2).map(|f| f.as_str());
    if let Some(mag) = c.get(3) {
        let word = match mag.as_str().to_ascii_lowercase().as_str() {
            "k" | "thousand" => "thousand",
            "m" | "million" => "million",
            _ => "billion",
        };
        return format!("{} {word} dollars", plain_number(int_part, frac));
    }
    let dollars: u64 = int_part.replace(',', "").parse().unwrap_or(0);
    let cents: u64 = frac.map(|f| format!("{:0<2}", &f[..f.len().min(2)]).parse().unwrap_or(0)).unwrap_or(0);
    let d = |n: u64| format!("{} {}", number_to_words(n), if n == 1 { "dollar" } else { "dollars" });
    let ct = |n: u64| format!("{} {}", number_to_words(n), if n == 1 { "cent" } else { "cents" });
    match (dollars, cents) {
        (d0, 0) => d(d0),
        (0, c0) => ct(c0),
        (d0, c0) => format!("{} and {}", d(d0), ct(c0)),
    }
}

/// Turns chat text into something a speech engine reads well: markup, links, code and emoji are removed; numbers, money, percentages,
/// dates, times and ordinals are spelled out; a colon becomes a comma. Four-digit numbers from 1100 to 2099 read as years (except 2000 to 2009).
pub fn prepare(text: &str) -> String {
    let rx = Rules::new();
    let mut s = rx.fence.replace_all(text, " a code block ").into_owned();
    s = rx.image.replace_all(&s, "$1").into_owned();
    s = rx.link.replace_all(&s, "$1").into_owned();
    s = rx.url.replace_all(&s, "a link").into_owned();
    s = s.chars().filter(|c| !is_emoji(*c)).collect();
    s = rx.heading.replace_all(&s, "").into_owned();
    s = rx.bullet.replace_all(&s, "").into_owned();
    s = rx.quote.replace_all(&s, "").into_owned();
    s = rx.emphasis.replace_all(&s, "").into_owned();
    s = rx.underscore.replace_all(&s, "$1$2").into_owned();
    s = rx
        .iso_date
        .replace_all(&s, |c: &Captures| {
            date_words(c[2].parse().unwrap_or(0), c[3].parse().unwrap_or(0), c[1].parse().unwrap_or(0)).unwrap_or_else(|| c[0].to_string())
        })
        .into_owned();
    s = rx
        .us_date
        .replace_all(&s, |c: &Captures| {
            date_words(c[1].parse().unwrap_or(0), c[2].parse().unwrap_or(0), c[3].parse().unwrap_or(0)).unwrap_or_else(|| c[0].to_string())
        })
        .into_owned();
    s = rx.money.replace_all(&s, |c: &Captures| money_words(c)).into_owned();
    s = rx.time.replace_all(&s, |c: &Captures| time_words(c).unwrap_or_else(|| c[0].to_string())).into_owned();
    s = rx
        .percent
        .replace_all(&s, |c: &Captures| format!("{} percent", plain_number(&c[1], c.get(2).map(|f| f.as_str()))))
        .into_owned();
    s = rx.ordinal.replace_all(&s, |c: &Captures| ordinal_words(c[1].parse().unwrap_or(0))).into_owned();
    s = rx
        .number
        .replace_all(&s, |c: &Captures| {
            let sign = if c.get(2).is_some() { "minus " } else { "" };
            let int_part = &c[3];
            let frac = c.get(4).map(|f| f.as_str());
            let year = frac.is_none() && !int_part.contains(',') && int_part.len() == 4;
            let y: u64 = int_part.parse().unwrap_or(0);
            let body = if year && (1100..=2099).contains(&y) && !(2000..=2009).contains(&y) {
                year_words(y)
            } else {
                plain_number(int_part, frac)
            };
            format!("{}{sign}{body}", &c[1])
        })
        .into_owned();
    let mut lines = vec![];
    for line in s.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut l = line.replace(": ", ", ").replace(':', ",");
        l = l.split_whitespace().collect::<Vec<_>>().join(" ");
        if !l.ends_with(['.', '!', '?', ',', '…']) {
            l.push('.');
        }
        lines.push(l);
    }
    lines.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cardinals() {
        assert_eq!(number_to_words(0), "zero");
        assert_eq!(number_to_words(21), "twenty-one");
        assert_eq!(number_to_words(100), "one hundred");
        assert_eq!(number_to_words(1250), "one thousand two hundred fifty");
        assert_eq!(number_to_words(1_000_001), "one million one");
        assert_eq!(number_to_words(2_500_000_000), "two billion five hundred million");
    }

    #[test]
    fn ordinals() {
        assert_eq!(ordinal_words(1), "first");
        assert_eq!(ordinal_words(12), "twelfth");
        assert_eq!(ordinal_words(20), "twentieth");
        assert_eq!(ordinal_words(21), "twenty-first");
        assert_eq!(ordinal_words(100), "one hundredth");
        assert_eq!(prepare("the 3rd and 4th"), "the third and fourth.");
    }

    #[test]
    fn money_example_from_spec() {
        assert_eq!(prepare("$1,250.90"), "one thousand two hundred fifty dollars and ninety cents.");
        assert_eq!(prepare("It costs $5"), "It costs five dollars.");
        assert_eq!(prepare("$1"), "one dollar.");
        assert_eq!(prepare("$0.50 off"), "fifty cents off.");
        assert_eq!(prepare("$3.5"), "three dollars and fifty cents.");
        assert_eq!(prepare("raised $2.5M"), "raised two point five million dollars.");
    }

    #[test]
    fn times() {
        assert_eq!(prepare("at 21:14"), "at nine fourteen PM.");
        assert_eq!(prepare("at 9:05 am"), "at nine oh five AM.");
        assert_eq!(prepare("at 14:00"), "at two PM.");
        assert_eq!(prepare("at 9:00"), "at nine o'clock.");
        assert_eq!(prepare("at 00:30"), "at twelve thirty AM.");
        assert_eq!(prepare("at 12:15"), "at twelve fifteen PM.");
    }

    #[test]
    fn percentages_and_decimals() {
        assert_eq!(prepare("50%"), "fifty percent.");
        assert_eq!(prepare("3.5% growth"), "three point five percent growth.");
        assert_eq!(prepare("pi is 3.14"), "pi is three point one four.");
        assert_eq!(prepare("it is -5 degrees"), "it is minus five degrees.");
    }

    #[test]
    fn dates_and_years() {
        assert_eq!(prepare("on 2026-03-04"), "on March fourth, twenty twenty-six.");
        assert_eq!(prepare("on 12/25/2019"), "on December twenty-fifth, twenty nineteen.");
        assert_eq!(prepare("in 2005"), "in two thousand five.");
        assert_eq!(prepare("in 1999"), "in nineteen ninety-nine.");
        assert_eq!(prepare("on 2026-13-40"), "on twenty twenty-six-thirteen-forty.");
    }

    #[test]
    fn numbers_inside_words_are_left_alone() {
        assert_eq!(prepare("use mp3 and abc123"), "use mp3 and abc123.");
        assert_eq!(prepare("1,250 users"), "one thousand two hundred fifty users.");
    }

    #[test]
    fn markdown_urls_code_and_emoji() {
        assert_eq!(prepare("**Done** and _nice_"), "Done and nice.");
        assert_eq!(prepare("# Title\n- one\n- two"), "Title. one. two.");
        assert_eq!(prepare("see [the docs](https://x.dev/a) now"), "see the docs now.");
        assert_eq!(prepare("go to https://example.com/a?b=1 now"), "go to a link now.");
        assert_eq!(prepare("before\n```rust\nfn main(){}\n```\nafter"), "before. a code block. after.");
        assert_eq!(prepare("great 🎉 job 👍"), "great job.");
        assert_eq!(prepare("run `ls -la`"), "run ls -la.");
    }

    #[test]
    fn colon_becomes_comma() {
        assert_eq!(prepare("Steps: first, then second"), "Steps, first, then second.");
        assert_eq!(prepare("Plan:\n- a\n- b"), "Plan, a. b.");
    }

    #[test]
    fn unclosed_fence_and_empty() {
        assert_eq!(prepare("```\nnever closed"), "a code block.");
        assert_eq!(prepare(""), "");
        assert_eq!(prepare("   \n\n "), "");
    }

    #[test]
    fn snake_case_keeps_underscores_inside_words() {
        assert_eq!(prepare("call my_func now"), "call my_func now.");
    }
}
