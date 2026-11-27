# Gesture pairwise video study: jsPsych + GitHub Pages + DataPipe + Prolific

A starter for running side-by-side video comparisons (BEAT2/GENEA style) on Prolific,
with no server of your own.

```
 Prolific ──link──► GitHub Pages (this repo: index.html + js + lists)
                        │   videos ◄── Cloudflare R2 (or stimuli/ while testing)
                        │
                        ├─ start: ask DataPipe "which list?" ─► 0, 1, 2, 3, 0, 1, ...
                        └─ end:   send CSV to DataPipe ─► saved as a file in your Google Drive
                                  then redirect back to Prolific with the completion code
```

| Piece | What it is | What it does here |
|---|---|---|
| **jsPsych** | JavaScript library for browser experiments | Runs the screens: consent, instructions, fullscreen, video trials, saving |
| **GitHub Pages** | Free static website hosting from a GitHub repo | Gives the study a public URL (`https://you.github.io/gesture-study/`) |
| **DataPipe** | Free service by the jsPsych team (pipe.jspsych.org) | Receives each participant's data file and writes it to Google Drive; hands out list numbers in rotation |
| **Google Drive** | Your Drive account | Where the data files end up |
| **Cloudflare R2** | Object storage with free downloads | Hosts the real video files |

## Files

```
index.html                  loads everything
js/config.js                <- the only file you normally edit (IDs, question, answer labels)
js/experiment.js            study flow
js/plugin-pairwise-video.js side-by-side video trial (locks answers until both videos finish)
css/style.css
vendor/                     jsPsych 8.4 + plugins (local copies)
lists/list_*.json           trial lists (generated, PUBLIC: contain no system names)
stimuli/                    demo videos (hashed names)
tools/make_demo_videos.py   placeholder clips for testing
tools/prepare_stimuli.py    compress + rename your renders, write the private manifest
tools/build_lists.py        balanced, left/right-mirrored trial lists (+ attention checks)
tools/decode_results.py     merge data files, add system names back, exclusions, summary
tools/stimuli_manifest.csv  PRIVATE hash -> system/clip key (gitignored)
```

---

## 1. Test on your own computer (5 minutes)

Needs Python 3. Browsers block loading videos from `file://`, so run a tiny local server:

```bash
cd gesture-study
python -m http.server 8000
```

Open **http://localhost:8000/?debug=1&list=0** in Chrome.

- `debug=1`: data is downloaded to your computer at the end; fullscreen isn't enforced.
- `list=2`: try a specific list.

To check the data:

```bash
mkdir -p results && mv ~/Downloads/pilot-0.1_*.csv results/
python tools/decode_results.py results/
```

## 2. Use your own videos

Name your renders `<system>__<clip>.mp4` (two underscores), e.g. `GT__clip01.mp4`, `Ours__clip01.mp4`.

```bash
python tools/prepare_stimuli.py my_renders/ stimuli/               # muted (realism)
python tools/prepare_stimuli.py my_renders/ stimuli/ --keep-audio  # speech (appropriateness)
python tools/build_lists.py --trials-per-list 25 --attention 4
```

`build_lists.py` prints the number of lists. Put it in `N_LISTS` in `js/config.js`.
Change `--salt` in `prepare_stimuli.py` to your own secret string.

For audio studies, set `PLAYBACK: "sequential"` and `MUTED: false` in `js/config.js`
(the left video plays, then the right, so two soundtracks never overlap).

## 3. Put it online with GitHub Pages

1. Create a new **public** repo on GitHub (Pages is free only for public repos), e.g. `gesture-study`.
2. Push this folder:
   ```bash
   git init && git add . && git commit -m "study"
   git branch -M main
   git remote add origin https://github.com/<you>/gesture-study.git
   git push -u origin main
   ```
3. On GitHub, go to repo **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
4. After about a minute: `https://<you>.github.io/gesture-study/?debug=1`

Because the repo is public, `.gitignore` keeps out `raw_videos/`, `results/` and the
**manifest** (it reveals which hash is which system). Keep the manifest backed up somewhere private.

## 4. Save data to Google Drive with DataPipe

1. Go to **https://pipe.jspsych.org**, sign up, and connect your Google account when asked.
2. Click **New Experiment**, choose **Google Drive**, and enter a title (e.g. `gesture-study`).
3. Optionally click **Choose Drive folder**; otherwise files go to `My Drive/DataPipe`.
4. Click **Create**, then in the experiment settings:
   - **Accept new data**: on (turn it off outside collection windows; the ID is public in the page source)
   - **Validation**: leave CSV allowed
   - **Condition assignment**: on, **n** = `N_LISTS` (set before recruiting; don't lower it mid-study)
   - **Session limit**: target N plus a buffer
   - **Psych-DS metadata**: off
5. Copy the **Experiment ID** into `DATAPIPE_ID` in `js/config.js`, then commit and push.

Now (without `?debug=1`) each participant gets the next list in rotation, and their CSV appears in the
Drive folder when they finish. If an upload fails, the file is downloaded on the participant's
computer and they're asked to send it to you.

Test it: open the site without `debug`, but with `&list=0` (so you don't use up a rotation slot), finish,
and check that a file appeared in Drive. Note this test file lands in the same folder as real data.

## 5. Host the real videos on Cloudflare R2

GitHub Pages sites are limited to 1 GB with ~100 GB/month bandwidth, and big videos make git slow,
so keep real videos out of the repo.

1. Create a Cloudflare account → **R2** → **Create bucket** (e.g. `gesture-stimuli`).
2. **Settings → Public access**: enable the `r2.dev` subdomain (fine for piloting; for the full run,
   Cloudflare recommends connecting a custom domain because r2.dev is rate-limited).
3. **Settings → CORS policy** (needed so the study can preload videos):
   ```json
   [{"AllowedOrigins": ["https://<you>.github.io", "http://localhost:8000"],
     "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600}]
   ```
4. Upload the hashed files from `stimuli/` (drag and drop in the dashboard, or `rclone copy stimuli r2:gesture-stimuli`).
5. Rebuild the lists with the bucket URL:
   ```bash
   python tools/build_lists.py --base-url https://pub-XXXX.r2.dev/ --trials-per-list 25
   ```
6. Delete the demo videos from `stimuli/`, then commit and push.

## 6. Set up the Prolific study

- **Study URL**:
  `https://<you>.github.io/gesture-study/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`
  (choose "I'll use URL parameters")
- **Completion**: "redirect", then copy the completion code into `PROLIFIC_COMPLETION_CODE`.
  Add a second code for "no consent" and put it in `PROLIFIC_NO_CONSENT_CODE`.
- **Devices**: desktop only. The study also blocks small screens and phones itself.
- Screeners as in the BEAT2 protocol if you want comparability (e.g. English as first language).
- Recruit in **multiples of `N_LISTS`**, so every list (and both left/right mirrors) is used equally.

## 7. Before launching: pilot checklist

- [ ] Replace the consent text in `js/experiment.js` with your IRB-approved version.
- [ ] Bump `STUDY_VERSION` in `config.js` whenever you change anything.
- [ ] Run the full study yourself in Chrome, Firefox and Safari (Mac).
- [ ] Pilot with 5–10 Prolific participants, then run `decode_results.py` on the downloaded Drive files and check every column.
- [ ] Check the feedback answers for "videos failed or stuttered".
- [ ] Check timing: the median `time_elapsed` at the end vs. what you pay for.

## What gets recorded (per video trial)

`response` (0–4), `response_label`, `rt` (ms from answer buttons unlocking), `trial_duration`,
`plays`, `replays`, `interruptions` (tab switch or leaving fullscreen during playback, which restarts the videos),
`left_src`, `right_src`, `is_attention`, `attention_target`, `attention_passed`, plus on every row
`prolific_pid`, `session_id`, `list_index`, `study_version`, `fullscreen_exits`, `user_agent`, `screen`.

`decode_results.py` adds `left_system`, `right_system`, `clip_id` and `excluded`
(the participant failed at least one attention check).
