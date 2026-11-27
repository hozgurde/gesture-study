/* Main study script. Flow:
 *   device check -> get list number -> load list JSON -> consent -> instructions
 *   -> fullscreen -> [preload block -> trials] x N -> feedback -> save -> back to Prolific
 *
 * URL options (for testing):
 *   ?debug=1   save data to your computer, don't force fullscreen
 *   ?list=1    use lists/list_1.json instead of asking DataPipe
 */

// ---- R2 video test ----------------------------------------------------------
// true: run only the short R2 test block below (no DataPipe, no Prolific).
// false: run the normal study.
const VIDEO_TEST = true;
const STIMULUS_BASE = "https://pub-a6a8ec460eda40c099c355d82f39e3c8.r2.dev/"; // public, ends with /
const TEST_FILES = ["3_testaudio_0_2_2.mp4", "3_testaudio_0_3_3.mp4"];

const jsPsych = initJsPsych({
  // Test mode only: show the collected data at the end.
  on_finish: VIDEO_TEST ? () => jsPsych.data.displayData() : undefined,
  show_progress_bar: true,
  auto_update_progress_bar: false,
  message_progress_bar: "Progress",
});

const url = (k) => jsPsych.data.getURLVariable(k);
const DEBUG = url("debug") === "1";
const SAVE_ONLINE = !DEBUG && CONFIG.DATAPIPE_ID !== "";

const PID = url("PROLIFIC_PID") || "anon";
const STUDY_ID = url("STUDY_ID") || "none";
const SESSION_ID = url("SESSION_ID") || jsPsych.randomization.randomID(10);

// ---------------------------------------------------------------------------
// Fullscreen guard: if the participant leaves fullscreen during the task,
// cover the page until they go back (a click is required to re-enter).
let inTask = false;
let fullscreenExits = 0;
let alertSaveFailed = false;
const overlay = document.createElement("div");
overlay.id = "fs-overlay";
overlay.innerHTML = `<div><p>This study must be done in full screen.</p>
  <button class="jspsych-btn" id="fs-return">Return to full screen</button></div>`;
document.body.appendChild(overlay);
document.getElementById("fs-return").addEventListener("click", () => {
  document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  const isFs = !!document.fullscreenElement;
  if (!isFs && inTask) fullscreenExits += 1;
  overlay.style.display = !isFs && inTask && !DEBUG ? "flex" : "none";
});

// ---------------------------------------------------------------------------
function blockMessage(html) {
  document.body.innerHTML = `<div class="block-msg">${html}</div>`;
}

function isProbablyMobile() {
  const touch = navigator.maxTouchPoints > 1 && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return touch || window.screen.width < CONFIG.MIN_SCREEN_WIDTH;
}

async function getListIndex() {
  const forced = url("list");
  if (forced !== undefined) return Number(forced);
  if (!SAVE_ONLINE) return 0;
  const c = await jsPsychPipe.getCondition(CONFIG.DATAPIPE_ID);
  if (typeof c !== "number") throw new Error("DataPipe condition assignment failed: " + JSON.stringify(c));
  return c % CONFIG.N_LISTS;
}

function makeTrial(t) {
  return {
    type: jsPsychPairwiseVideo,
    left_src: t.left.src,
    right_src: t.right.src,
    question: CONFIG.QUESTION,
    choices: CONFIG.CHOICES,
    playback: CONFIG.PLAYBACK,
    muted: CONFIG.MUTED,
    video_width: CONFIG.VIDEO_WIDTH,
    attention_text: t.attention_target != null
      ? `[Attention check] Please choose “${CONFIG.CHOICES[t.attention_target]}”.`
      : null,
    attention_target: t.attention_target ?? null,
    // Systems/clips are NOT in the public list files; decode_results.py adds them
    // from the private manifest using left_src / right_src.
    meta: {
      task: "pairwise",
      is_attention: t.attention_target != null,
    },
  };
}

async function main() {
  if (isProbablyMobile() && !DEBUG) {
    blockMessage(`<p>This study needs a desktop or laptop computer with a large screen.</p>
      <p>Please return the study on Prolific. Sorry for the inconvenience.</p>`);
    return;
  }

  let listIndex, list;
  try {
    listIndex = await getListIndex();
    const res = await fetch(`lists/list_${listIndex}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`lists/list_${listIndex}.json: HTTP ${res.status}`);
    list = await res.json();
  } catch (err) {
    console.error(err);
    blockMessage(`<p>Sorry, the study could not start (${err.message}).</p>
      <p>Please reload the page. If it happens again, message the researcher on Prolific.</p>`);
    return;
  }

  jsPsych.data.addProperties({
    prolific_pid: PID,
    study_id: STUDY_ID,
    session_id: SESSION_ID,
    list_index: listIndex,
    study_version: CONFIG.STUDY_VERSION,
  });

  const trials = list.trials;
  const total = trials.length;
  let done = 0;
  const timeline = [];

  // --- Consent -------------------------------------------------------------
  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: `<div class="text-page">
      <h2>Consent</h2>
      <p><i>Replace this text with your IRB-approved consent form.</i></p>
      <p>In this study you will watch short videos of animated characters and compare them.
         It takes about ${list.estimated_minutes ?? 20} minutes.</p>
    </div>`,
    choices: ["I agree", "I do not agree"],
    data: { task: "consent" },
    on_finish: (d) => {
      if (d.response === 1) {
        jsPsych.abortExperiment(`<p>You chose not to participate. Redirecting you to Prolific…</p>`);
        setTimeout(() => {
          window.location.href = `https://app.prolific.com/submissions/complete?cc=${CONFIG.PROLIFIC_NO_CONSENT_CODE}`;
        }, 1500);
      }
    },
  });

  // --- Instructions --------------------------------------------------------
  timeline.push({
    type: jsPsychInstructions,
    pages: [
      `<div class="text-page"><h2>Instructions</h2>
        <p>On each screen you will see <b>two videos</b> of an animated character.</p>
        <p>Press <b>Play</b> and watch both videos to the end. The answer buttons unlock only after that.</p>
        <p>Then answer: <i>${CONFIG.QUESTION}</i></p></div>`,
      `<div class="text-page"><h2>Before you start</h2>
        <p>The study runs in <b>full screen</b>. Please don't switch tabs or windows.
           If you do, the videos restart.</p>
        <p>Some screens contain attention checks. Please read everything carefully.</p></div>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions" },
  });

  timeline.push({
    type: jsPsychFullscreen,
    fullscreen_mode: true,
    message: `<p>The study will now switch to full screen.</p>`,
    button_label: "Enter full screen",
    on_finish: () => { inTask = true; },
  });

  // --- Trials, preloaded in small blocks -----------------------------------
  for (let i = 0; i < total; i += CONFIG.PRELOAD_BLOCK) {
    const block = trials.slice(i, i + CONFIG.PRELOAD_BLOCK);
    timeline.push({
      type: jsPsychPreload,
      video: block.flatMap((t) => [t.left.src, t.right.src]),
      message: "<p>Loading videos…</p>",
      max_load_time: 60000,
      continue_after_error: true, // the trial itself shows an error if a video is missing
      data: { task: "preload" },
    });
    block.forEach((t) =>
      timeline.push({
        ...makeTrial(t),
        on_finish: () => {
          done += 1;
          jsPsych.progressBar.progress = done / total;
        },
      })
    );
  }

  // --- End-of-study questions ----------------------------------------------
  timeline.push({
    type: jsPsychFullscreen,
    fullscreen_mode: false,
    delay_after: 0,
    on_start: () => { inTask = false; },
  });
  timeline.push({
    type: jsPsychSurveyHtmlForm,
    preamble: "<h3>Almost done</h3>",
    html: `<div class="text-page" style="text-align:left">
      <p>Did any video fail to play or stutter?<br>
        <label><input type="radio" name="playback_problems" value="no" required> No</label>
        <label><input type="radio" name="playback_problems" value="yes"> Yes</label></p>
      <p>Any comments? (optional)<br><textarea name="comments" rows="4" cols="60"></textarea></p>
    </div>`,
    button_label: "Continue",
    data: { task: "feedback" },
  });

  // --- Save ------------------------------------------------------------------
  const filename = `${CONFIG.STUDY_VERSION}_list${listIndex}_${PID}_${SESSION_ID}.csv`;
  const addSummary = () =>
    jsPsych.data.addProperties({
      fullscreen_exits: fullscreenExits,
      user_agent: navigator.userAgent,
      screen: `${window.screen.width}x${window.screen.height}`,
    });

  if (SAVE_ONLINE) {
    timeline.push({
      type: jsPsychPipe,
      action: "save",
      experiment_id: CONFIG.DATAPIPE_ID,
      filename,
      data_string: () => { addSummary(); return jsPsych.data.get().csv(); },
      on_start: () => { inTask = false; },
      on_finish: (d) => {
        // If the upload failed, let the participant download the file and send it to you.
        if (!d.success) {
          console.error("DataPipe save failed:", d.result);
          jsPsych.data.get().localSave("csv", filename);
          alertSaveFailed = true;
        }
      },
    });
    timeline.push({
      conditional_function: () => alertSaveFailed,
      timeline: [{
        type: jsPsychHtmlButtonResponse,
        stimulus: `<p><b>Your data could not be uploaded automatically.</b></p>
          <p>A file named <code>${filename}</code> was downloaded. Please send it to the researcher
             through Prolific's messaging. You will still be paid.</p>`,
        choices: ["Continue"],
      }],
    });
  } else {
    timeline.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: `<p><b>Test mode:</b> no DataPipe ID is set (or ?debug=1),
                 so the data will be downloaded as <code>${filename}</code>.</p>`,
      choices: ["Download data"],
      on_finish: () => { addSummary(); jsPsych.data.get().localSave("csv", filename); },
    });
  }

  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: `<p>Thank you! Your responses have been saved.</p>
      <p>Press the button to go back to Prolific and finish.</p>`,
    choices: ["Back to Prolific"],
    on_finish: () => {
      if (SAVE_ONLINE) {
        window.location.href = `https://app.prolific.com/submissions/complete?cc=${CONFIG.PROLIFIC_COMPLETION_CODE}`;
      }
    },
  });

  await jsPsych.run(timeline);
}

// Minimal R2 test: preload -> Start click (lets videos autoplay with sound)
// -> both videos in random order. Runs before any DataPipe call, so it
// doesn't use up a condition number.
async function runVideoTest() {
  const stimuli = TEST_FILES.map((file) => ({ file, sources: [STIMULUS_BASE + file] }));

  await jsPsych.run([
    {
      type: jsPsychPreload,
      video: stimuli.flatMap((s) => s.sources),
      message: "<p>Loading videos…</p>",
      data: { task: "preload" },
    },
    {
      type: jsPsychHtmlButtonResponse,
      stimulus: "<p>Video test. Press Start to play the videos.</p>",
      choices: ["Start"],
      data: { task: "start" },
    },
    {
      timeline: [{
        type: jsPsychVideoButtonResponse,
        stimulus: jsPsych.timelineVariable("sources"),
        prompt: "<p>Placeholder question: did this video play correctly?</p>",
        choices: ["Yes", "No"],
        response_allowed_while_playing: false,
        width: 640,
        data: { task: "video_test", video: jsPsych.timelineVariable("file") },
      }],
      timeline_variables: stimuli,
      randomize_order: true,
    },
  ]);
}

if (VIDEO_TEST) runVideoTest();
else main();
