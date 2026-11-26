# Medical Physics Study Guide

A free study guide for medical physics students preparing for their qualifying and
board exams (ABR Part 1 and 2, end-of-program comprehensive exams). Short name: MPSG.

- **Flashcards with spaced repetition**: 257 cards across ten topics. Each day mixes a
  few new cards (15 by default) with the ones due for review; rate each Again, Hard,
  Good or Easy. Same scheduler as [Words](https://github.com/mco-gh/words),
  [Geo](https://github.com/mco-gh/geo) and [Frets](https://github.com/mco-gh/frets).
- **Practice questions**: 113 multiple-choice questions with worked explanations.
  Modes: Quick 10 (unseen and missed questions first), a drill on one topic, a timed
  40-question mock exam scored at the end, and a round of the questions you missed.
- **The guide**: high-yield notes per topic, a formula sheet, key constants and a
  nuclide table, all searchable.
- **Today and Progress**: an exam-date countdown with a pace check, streak, a daily
  "high-yield fact", an 18-week activity calendar, mastery and accuracy by topic, and a
  14-day review forecast.

A fully static, offline-capable progressive web app: no server code, no build step,
no login, all progress in the browser's localStorage.

## Topics

Radiation physics · Dosimetry · Radiobiology · Radiation protection · Radiography,
fluoro & CT · Imaging science & statistics · MRI & ultrasound · Nuclear medicine & PET ·
External beam therapy · Brachytherapy. Any can be paused in Settings.

## Where it lives

Published at https://mco.dev/mpsg/. This repo is mounted in
[mco-gh/mco.dev](https://github.com/mco-gh/mco.dev) (a Hugo site) as a git submodule
at `static/mpsg`, so **everything in this repo is public** at `https://mco.dev/mpsg/...`.

## Run it locally

From a checkout of mco.dev, serve the site's `static/` folder so URLs match production:

    python3 -m http.server 4174 --directory static

Then open http://localhost:4174/mpsg/. The service worker caches everything, so while
developing, unregister it (DevTools → Application) or reloads may show old files.

## Files

| File | What it does |
|---|---|
| `index.html`, `styles.css` | the page and its "Cherenkov" look |
| `app.js` | Today, the flashcard session, practice runs, the guide, Progress, settings, backup |
| `srs.js` | the SM-2-style scheduler (shared with Words, Geo, Frets) and new-card orders |
| `store.js` | localStorage persistence (`mpsg:settings`, `mpsg:progress`, `mpsg:quiz`, `mpsg:scheme`) |
| `data/topics.js` | the ten topics, their colors and high-yield notes |
| `data/cards.js` | the flashcards |
| `data/questions.js` | the practice questions |
| `data/reference.js` | formulas, constants and the nuclide table |

## Editing the content

Cards are `[id, front, back, more]` and questions `[id, text, choices, correct, why]`.
The first four letters of an id are its topic. Progress is keyed by id, so never
renumber: add new items at the end of a topic with the next free number. Text may use
`<sub>`, `<sup>`, `<b>`, `<i>` and `<br>`. Choices are shuffled when shown, so don't
write "all of the above". Put the correct choice first (index 0) by convention.

The content was written from standard references (Khan, Attix, Bushberg, Hall, AAPM
task group reports, ICRP, NCRP, NRC regulations). It's a study aid, not an authority:
corrections are welcome.

## Updating

Bump `VERSION` in `sw.js` whenever any file changes, so installed copies pick it up.
Icons are rendered from `icons/icon.svg` and `build/icons/full-bleed.svg` with
`bash build/icons/render.sh`.
