let audioCtx = null
let gainNode = null
let isUnlocked = false
let currentBGM = null
let bgmVolume = 1.0
let bgmFadeTimer = null

const volume = parseFloat(localStorage.getItem('audio_volume') || '0.5')
const isMuted = localStorage.getItem('audio_muted') === 'true'

const soundMap = {
  flip_card: '/audio/flip_card.wav',
  lose: '/audio/lose.wav',
  open_box: '/audio/open_box.wav',
  win: '/audio/win.wav',
  backend_1: '/audio/backend-1.wav',
  backend_2: '/audio/backend-2.wav',
  chips: '/audio/chips.wav',
  deal_card: '/audio/deal_card.wav'
}

function unlock() {
  if (isUnlocked) return
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    gainNode = audioCtx.createGain()
    gainNode.connect(audioCtx.destination)
  }
  if (audioCtx.state === 'suspended') audioCtx.resume()
  isUnlocked = true
  document.removeEventListener('click', unlock)
  document.removeEventListener('touchstart', unlock)
}
document.addEventListener('click', unlock)
document.addEventListener('touchstart', unlock)

function applyVolume() {
  if (gainNode) {
    gainNode.gain.value = isMuted ? 0 : volume
  }
  if (currentBGM) {
    currentBGM.volume = isMuted ? 0 : volume * bgmVolume
  }
}

function play(name) {
  if (!isUnlocked || isMuted) return
  if (soundMap[name]) {
    const audio = new Audio(soundMap[name])
    audio.volume = volume
    audio.play().catch(() => {})
  } else if (name === 'bubble') {
    playTone(800, 0.05, 0.3)
  } else if (name === 'tick') {
    playTone(1000, 0.1, 0.2)
  }
}

function playTone(freq, duration, vol) {
  if (!audioCtx || isMuted) return
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.value = vol
  osc.connect(g)
  g.connect(audioCtx.destination)
  const now = audioCtx.currentTime
  osc.start(now)
  osc.stop(now + duration)
}

function switchBGM(name) {
  if (!isUnlocked) return
  if (bgmFadeTimer) { clearInterval(bgmFadeTimer); bgmFadeTimer = null }
  const doSwitch = () => {
    if (currentBGM) {
      currentBGM.pause()
      currentBGM.src = ''
      currentBGM = null
    }
    if (name && soundMap[name]) {
      currentBGM = new Audio(soundMap[name])
      currentBGM.loop = true
      currentBGM.volume = 0
      currentBGM.play().catch(() => {})
      let v = 0
      bgmFadeTimer = setInterval(() => {
        v += 0.05
        if (v >= bgmVolume) {
          v = bgmVolume
          clearInterval(bgmFadeTimer)
          bgmFadeTimer = null
        }
        currentBGM.volume = isMuted ? 0 : v * volume
      }, 50)
    }
  }
  if (currentBGM && !currentBGM.paused) {
    let v = currentBGM.volume
    bgmFadeTimer = setInterval(() => {
      v -= 0.05
      if (v <= 0) {
        v = 0
        clearInterval(bgmFadeTimer)
        bgmFadeTimer = null
        doSwitch()
      } else {
        currentBGM.volume = v
      }
    }, 50)
  } else {
    doSwitch()
  }
}

function setVolume(val) {
  if (val < 0) val = 0
  if (val > 1) val = 1
  volume = val
  localStorage.setItem('audio_volume', val.toString())
  applyVolume()
}

function toggleMute() {
  isMuted = !isMuted
  localStorage.setItem('audio_muted', isMuted.toString())
  applyVolume()
}

export const audioManager = {
  play,
  switchBGM,
  setVolume,
  toggleMute,
  get volume() { return volume },
  get isMuted() { return isMuted },
  get currentBGMName() { return currentBGM ? Object.keys(soundMap).find(k => soundMap[k] === currentBGM.src) || null : null }
}
