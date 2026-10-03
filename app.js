import {
    HandLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";


// ======================================================
// DOM ELEMENTS
// ======================================================

const video = document.getElementById("webcam");
const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d");

const status = document.getElementById("status");
const gestureText = document.getElementById("gesture");
const chordText = document.getElementById("chord");

const volumeBar = document.getElementById("volumeBar");
const pitchBar = document.getElementById("pitchBar");


// ======================================================
// VARIABLES
// ======================================================

let handLandmarker = null;

let audioStarted = false;
let audioContext = null;
let masterGain = null;


// Camera
let lastVideoTime = -1;


// ------------------------------------------------------
// GESTURE STABILIZATION
// ------------------------------------------------------

let candidateGesture = null;
let candidateSince = 0;

let currentGesture = null;


// ------------------------------------------------------
// AUDIO STATE
// ------------------------------------------------------

let currentChord = null;
let currentVoices = [];


// How quickly one chord changes into another
const TRANSITION_TIME = 0.35;


// How long the camera must agree before changing chord
const GESTURE_STABLE_TIME = 180;


// ======================================================
// CAMERA
// ======================================================

async function startCamera() {

    try {

        status.textContent =
            "STARTING CAMERA...";


        const stream =
            await navigator.mediaDevices.getUserMedia({

                video: {
                    width: 1280,
                    height: 720
                },

                audio: false

            });


        video.srcObject = stream;


        video.onloadeddata = async () => {

            canvas.width =
                video.videoWidth;

            canvas.height =
                video.videoHeight;


            await setupHandTracking();

        };


    } catch (error) {

        console.error(
            "CAMERA ERROR:",
            error
        );


        status.textContent =
            "CAMERA ERROR";

    }

}


// ======================================================
// HAND AI
// ======================================================

async function setupHandTracking() {

    try {

        status.textContent =
            "LOADING HAND AI...";


        const vision =
            await FilesetResolver.forVisionTasks(

                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"

            );


        handLandmarker =
            await HandLandmarker.createFromOptions(

                vision,

                {

                    baseOptions: {

                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

                    },


                    runningMode:
                        "VIDEO",


                    // Detect both hands
                    numHands:
                        2,


                    minHandDetectionConfidence:
                        0.5,


                    minHandPresenceConfidence:
                        0.5,


                    minTrackingConfidence:
                        0.5

                }

            );


        status.textContent =
            audioStarted
                ? "CAMERA + AUDIO LIVE"
                : "CAMERA LIVE";


        detectHands();


    } catch (error) {

        console.error(
            "HAND AI ERROR:",
            error
        );


        status.textContent =
            "HAND AI ERROR";

    }

}


// ======================================================
// DETECTION LOOP
// ======================================================

function detectHands() {

    function loop() {

        if (

            handLandmarker &&

            video.readyState >= 2 &&

            video.currentTime !==
                lastVideoTime

        ) {

            lastVideoTime =
                video.currentTime;


            const results =
                handLandmarker.detectForVideo(

                    video,

                    performance.now()

                );


            processHands(results);

        }


        requestAnimationFrame(loop);

    }


    loop();

}


// ======================================================
// PROCESS HANDS
// ======================================================

function processHands(results) {

    ctx.clearRect(

        0,
        0,
        canvas.width,
        canvas.height

    );


    const hands =
        results.landmarks || [];


    // --------------------------------------------------
    // NO HAND
    // --------------------------------------------------

    if (hands.length === 0) {

        gestureText.textContent =
            "NO HAND";


        chordText.textContent =
            "--";


        volumeBar.style.width =
            "0%";


        pitchBar.style.width =
            "0%";


        return;

    }


    // --------------------------------------------------
    // DRAW ALL HANDS
    // --------------------------------------------------

    hands.forEach(
        hand => drawHand(hand)
    );


    // --------------------------------------------------
    // COUNT FINGERS
    // --------------------------------------------------

    const fingerCounts =
        hands.map(
            hand => countFingers(hand)
        );


    if (hands.length === 1) {

        gestureText.textContent =
            `${fingerCounts[0]} FINGERS`;

    } else {

        gestureText.textContent =
            `${fingerCounts[0]} + ${fingerCounts[1]} FINGERS`;

    }


    // --------------------------------------------------
    // FIRST HAND = CHORD
    // --------------------------------------------------

    const chord =
        getChord(
            fingerCounts[0]
        );


    chordText.textContent =
        chord.name;


    // --------------------------------------------------
    // HAND POSITION
    // --------------------------------------------------

    const hand =
        hands[0];


    const palmX =
        hand[0].x;


    const palmY =
        hand[0].y;


    // --------------------------------------------------
    // VOLUME
    // --------------------------------------------------

    const volume =
        Math.max(

            0,

            Math.min(

                1,

                1 - palmY

            )

        );


    volumeBar.style.width =
        `${volume * 100}%`;


    // --------------------------------------------------
    // PITCH
    // --------------------------------------------------

    const pitch =
        Math.max(

            0,

            Math.min(

                1,

                1 - palmX

            )

        );


    pitchBar.style.width =
        `${pitch * 100}%`;


    // --------------------------------------------------
    // AUDIO
    // --------------------------------------------------

    if (!audioStarted) {

        return;

    }


    const gesture =
        `${fingerCounts[0]}-${chord.name}`;


    handleGesture(
        gesture,
        chord,
        volume,
        pitch
    );

}


// ======================================================
// GESTURE STABILIZATION
// ======================================================

function handleGesture(
    gesture,
    chord,
    volume,
    pitch
) {

    const now =
        performance.now();


    // Same as current chord:
    // DO NOTHING.
    //
    // This is extremely important.
    //
    // We don't keep retriggering the chord.

    if (
        gesture === currentGesture
    ) {

        return;

    }


    // New candidate gesture

    if (
        gesture !== candidateGesture
    ) {

        candidateGesture =
            gesture;


        candidateSince =
            now;


        return;

    }


    // Wait until camera agrees
    // continuously for a short time

    if (
        now - candidateSince <
        GESTURE_STABLE_TIME
    ) {

        return;

    }


    // --------------------------------------------------
    // NOW REALLY CHANGE CHORD
    // --------------------------------------------------

    currentGesture =
        gesture;


    candidateGesture =
        null;


    transitionToChord(
        chord,
        volume,
        pitch
    );

}


// ======================================================
// SMOOTH CHORD TRANSITION
// ======================================================

function transitionToChord(
    chord,
    volume,
    pitch
) {

    if (!audioContext ||
        !masterGain) {

        return;

    }


    const now =
        audioContext.currentTime;


    // --------------------------------------------------
    // Fade OLD chord out
    // --------------------------------------------------

    currentVoices.forEach(
        voice => {

            try {

                voice.gain.gain.cancelScheduledValues(
                    now
                );


                voice.gain.gain.setValueAtTime(
                    Math.max(
                        0.0001,
                        voice.gain.gain.value
                    ),
                    now
                );


                voice.gain.gain.exponentialRampToValueAtTime(

                    0.0001,

                    now +
                    TRANSITION_TIME

                );


                voice.stop(
                    now +
                    TRANSITION_TIME +
                    0.05
                );


            } catch (error) {

                // Voice may already be stopped
            }

        }
    );


    currentVoices = [];


    // --------------------------------------------------
    // Create NEW chord
    // --------------------------------------------------

    currentChord =
        chord;


    currentVoices =
        createChordVoices(

            chord.notes,

            volume,

            pitch,

            now

        );

}


// ======================================================
// CREATE SUSTAINED CHORD
// ======================================================

function createChordVoices(
    frequencies,
    volume,
    pitchPosition,
    startTime
) {

    const voices = [];


    // Keep pitch controlled

    const pitchMultiplier =
        0.92 +
        pitchPosition * 0.16;


    frequencies.forEach(
        (frequency, index) => {


            const voice =
                createGuitarVoice(

                    frequency *
                    pitchMultiplier,

                    volume,

                    startTime +

                    index *
                    0.025

                );


            voices.push(
                voice
            );

        }
    );


    return voices;

}


// ======================================================
// GUITAR VOICE
// ======================================================

function createGuitarVoice(
    frequency,
    volume,
    startTime
) {

    const ctx =
        audioContext;


    // --------------------------------------------------
    // GAIN ENVELOPE
    // --------------------------------------------------

    const gain =
        ctx.createGain();


    gain.gain.setValueAtTime(

        0.0001,

        startTime

    );


    // Smooth attack

    gain.gain.exponentialRampToValueAtTime(

        Math.max(

            0.035,

            volume * 0.42

        ),

        startTime + 0.08

    );


    // --------------------------------------------------
    // FILTER
    // --------------------------------------------------

    const filter =
        ctx.createBiquadFilter();


    filter.type =
        "lowpass";


    filter.frequency.setValueAtTime(

        3000,

        startTime

    );


    filter.Q.value =
        0.65;


    // --------------------------------------------------
    // MAIN STRING
    // --------------------------------------------------

    const oscillator =
        ctx.createOscillator();


    oscillator.type =
        "triangle";


    oscillator.frequency.setValueAtTime(

        frequency,

        startTime

    );


    // --------------------------------------------------
    // HARMONIC 1
    // --------------------------------------------------

    const harmonic =
        ctx.createOscillator();


    harmonic.type =
        "sine";


    harmonic.frequency.setValueAtTime(

        frequency * 2,

        startTime

    );


    const harmonicGain =
        ctx.createGain();


    harmonicGain.gain.value =
        0.08;


    // --------------------------------------------------
    // HARMONIC 2
    // --------------------------------------------------

    const harmonic3 =
        ctx.createOscillator();


    harmonic3.type =
        "sine";


    harmonic3.frequency.setValueAtTime(

        frequency * 3,

        startTime

    );


    const harmonic3Gain =
        ctx.createGain();


    harmonic3Gain.gain.value =
        0.025;


    // --------------------------------------------------
    // CONNECTIONS
    // --------------------------------------------------

    oscillator.connect(
        gain
    );


    harmonic.connect(
        harmonicGain
    );


    harmonicGain.connect(
        gain
    );


    harmonic3.connect(
        harmonic3Gain
    );


    harmonic3Gain.connect(
        gain
    );


    gain.connect(
        filter
    );


    filter.connect(
        masterGain
    );


    // --------------------------------------------------
    // START
    // --------------------------------------------------

    oscillator.start(
        startTime
    );


    harmonic.start(
        startTime
    );


    harmonic3.start(
        startTime
    );


    // Don't automatically stop.

    // It stays alive until
    // another chord replaces it.


    return {

        oscillator,

        harmonic,

        harmonic3,

        gain

    };

}


// ======================================================
// DRAW HAND
// ======================================================

function drawHand(landmarks) {

    const connections = [

        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],

        [0, 5],
        [5, 6],
        [6, 7],
        [7, 8],

        [0, 9],
        [9, 10],
        [10, 11],
        [11, 12],

        [0, 13],
        [13, 14],
        [14, 15],
        [15, 16],

        [0, 17],
        [17, 18],
        [18, 19],
        [19, 20]

    ];


    ctx.strokeStyle =
        "#ffffff";


    ctx.lineWidth =
        2;


    connections.forEach(
        ([a, b]) => {

            ctx.beginPath();


            ctx.moveTo(

                landmarks[a].x *
                    canvas.width,

                landmarks[a].y *
                    canvas.height

            );


            ctx.lineTo(

                landmarks[b].x *
                    canvas.width,

                landmarks[b].y *
                    canvas.height

            );


            ctx.stroke();

        }
    );


    landmarks.forEach(
        point => {

            ctx.beginPath();


            ctx.arc(

                point.x *
                    canvas.width,

                point.y *
                    canvas.height,

                5,

                0,

                Math.PI * 2

            );


            ctx.fillStyle =
                "#ffffff";


            ctx.fill();

        }
    );

}


// ======================================================
// FINGER COUNT
// ======================================================

function countFingers(lm) {

    let count = 0;


    // Index

    if (
        lm[8].y <
        lm[6].y
    ) {

        count++;

    }


    // Middle

    if (
        lm[12].y <
        lm[10].y
    ) {

        count++;

    }


    // Ring

    if (
        lm[16].y <
        lm[14].y
    ) {

        count++;

    }


    // Pinky

    if (
        lm[20].y <
        lm[18].y
    ) {

        count++;

    }


    // Thumb

    if (
        lm[4].x >
        lm[3].x
    ) {

        count++;

    }


    return count;

}


// ======================================================
// CHORD MAP
// ======================================================

function getChord(fingers) {

    const chords = {

        0: {

            name: "Am",

            notes: [
                110.00,
                130.81,
                164.81
            ]

        },


        1: {

            name: "C",

            notes: [
                130.81,
                164.81,
                196.00
            ]

        },


        2: {

            name: "D",

            notes: [
                146.83,
                185.00,
                220.00
            ]

        },


        3: {

            name: "Em",

            notes: [
                164.81,
                196.00,
                246.94
            ]

        },


        4: {

            name: "G",

            notes: [
                98.00,
                123.47,
                146.83
            ]

        },


        5: {

            name: "A",

            notes: [
                110.00,
                138.59,
                164.81
            ]

        }

    };


    return (
        chords[fingers] ||
        chords[0]
    );

}


// ======================================================
// START AUDIO
// ======================================================

async function startAudio() {

    try {

        status.textContent =
            "STARTING AUDIO...";


        // Create audio context

        if (!audioContext) {

            audioContext =
                new (

                    window.AudioContext ||
                    window.webkitAudioContext

                )();

        }


        // Resume

        if (
            audioContext.state ===
            "suspended"
        ) {

            await audioContext.resume();

        }


        if (
            audioContext.state !==
            "running"
        ) {

            throw new Error(
                "AudioContext is not running."
            );

        }


        // ------------------------------------------------
        // MASTER VOLUME
        // ------------------------------------------------

        masterGain =
            audioContext.createGain();


        masterGain.gain.value =
            3.0;


        masterGain.connect(
            audioContext.destination
        );


        audioStarted =
            true;


        status.textContent =
            "CAMERA + AUDIO LIVE 🎸";


        // ------------------------------------------------
        // TEST CHORD
        // ------------------------------------------------

        const testChord = {

            name: "C",

            notes: [
                130.81,
                164.81,
                196.00
            ]

        };


        currentGesture =
            "AUDIO-TEST";


        transitionToChord(

            testChord,

            0.8,

            0.5

        );


        console.log(
            "🎸 SMOOTH AUDIO READY"
        );


    } catch (error) {

        console.error(
            "AUDIO ERROR:",
            error
        );


        status.textContent =
            "AUDIO ERROR";


        alert(
            "Audio error: " +
            error.message
        );

    }

}


// ======================================================
// BUTTONS
// ======================================================

document
    .getElementById("startCamera")
    .addEventListener(
        "click",
        startCamera
    );


document
    .getElementById("startAudio")
    .addEventListener(
        "click",
        startAudio
    );