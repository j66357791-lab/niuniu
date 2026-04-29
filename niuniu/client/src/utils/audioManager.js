let audioCtx = null
let gainNode = null
let isUnlocked = false
let currentBGM = null
let currentBGMKey = null
let bgmVolume = 1.0
let bgmFadeTimer = null

let volume = parseFloat(localStorage.getItem('audio_volume') || '0.5')
let isMuted = localStorage.getItem('audio_muted') === 'true'

const soundMap = {
  flip_card: '/audio/flip_card.wav',
  lose: '/audio/lose.wav',
  open_box: '/audio/open_box.wav',
  win: '/audio/win.wav',
  'backend-1': '/audio/backend-1.wav',   // 下划线 → 连字符
  'backend-2': '/audio/backend-2.wav',
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
  
  // 【终极破冰】：在点击的瞬间，静音播放一段 1 毫秒的无声 base64 音频
  // 彻底解除 HTML5 <audio> 标签在部分浏览器的首次播放封锁
  try {
    const iceBreaker = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=')
    iceBreaker.volume = 0
    iceBreaker.play().catch(() => {})
  } catch(e) {}

  isUnlocked = true
  document.removeEventListener('click', unlock)
  document.removeEventListener('touchstart', unlock)
}
document.addEventListener('click', unlock)
document.addEventListener('touchstart', unlock)

function applyVolume() {
  if (gainNode) { gainNode.gain.value = isMuted ? 0 : volume }
  if (currentBGM && !bgmFadeTimer) { currentBGM.volume = isMuted ? 0 : volume * bgmVolume }
}

function play(name) {
  if (!isUnlocked) return
  if (isMuted && name !== 'bubble' && name !== 'tick') return

  if (soundMap[name]) {
    const audio = new Audio(soundMap[name])
    audio.volume = volume
    audio.play().catch((err) => {
      // 【诊断】：如果普通音效也不响，看这里
      console.warn(`[Audio] 播放失败 ${name}:`, err.message)
    })
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
  if (!isUnlocked) return currentBGMKey
  
  if (bgmFadeTimer) { clearInterval(bgmFadeTimer); bgmFadeTimer = null }

  const doSwitch = () => {
    if (currentBGM) { currentBGM.pause(); currentBGM.src = ''; currentBGM = null }
    currentBGMKey = null

    if (name && soundMap[name]) {
      currentBGMKey = name
      currentBGM = new Audio(soundMap[name])
      currentBGM.loop = true
      currentBGM.volume = 0
      
      currentBGM.play().catch((err) => {
        // 【终极诊断】：如果背景音乐不响，点♫按钮后看这里！
        console.error(`[BGM失败] 名字:${name}, 路径:${soundMap[name]}, 原因:`, err.message)
        currentBGMKey = null 
      })

      let v = 0
      bgmFadeTimer = setInterval(() => {
        v += 0.05
        if (v >= bgmVolume) { v = bgmVolume; clearInterval(bgmFadeTimer); bgmFadeTimer = null }
        currentBGM.volume = isMuted ? 0 : v * volume
      }, 50)
    }
    return currentBGMKey
  }

  if (currentBGM && !currentBGM.paused) {
    let v = currentBGM.volume
    bgmFadeTimer = setInterval(() => {
      v -= 0.05
      if (v <= 0) { v = 0; clearInterval(bgmFadeTimer); bgmFadeTimer = null; doSwitch() }
      else { currentBGM.volume = v }
    }, 50)
    return null
  } else {
    return doSwitch()
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
  get currentBGMName() { return currentBGMKey }
}
