let audioCtx = null
let gainNode = null
let isUnlocked = false
let currentBGM = null
let currentBGMKey = null
let bgmVolume = 1.0
let bgmFadeTimer = null
let volume = parseFloat(localStorage.getItem('audio_volume') || '0.5')
let isMuted = localStorage.getItem('audio_muted') === 'true'

// 【新增】专门用来存放短音效的“内存数据”
let sfxBuffers = {} 

const soundMap = {
  flip_card: '/audio/flip_card.wav',
  lose: '/audio/lose.wav',
  open_box: '/audio/open_box.wav',
  win: '/audio/win.wav',
  'backend-1': '/audio/backend-1.wav',
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
  
  try {
    const iceBreaker = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=')
    iceBreaker.volume = 0
    iceBreaker.play().catch(() => {})
  } catch(e) {}
  
  isUnlocked = true
  document.removeEventListener('click', unlock)
  document.removeEventListener('touchstart', unlock)
  
  // 【新增】解锁后，立刻在后台悄悄下载所有短音效到内存里
  preloadSFX()
}

// 【新增】预加载函数：把 wav 拉下来变成二进制存进 sfxBuffers
async function preloadSFX() {
  if (!audioCtx) return
  for (const [name, url] of Object.entries(soundMap)) {
    // 背景音乐不需要预加载到内存，跳过
    if (name.startsWith('backend')) continue 
    
    try {
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      sfxBuffers[name] = audioBuffer // 存起来！
    } catch (err) {
      console.error(`预加载音效失败 ${name}:`, err)
    }
  }
}

function applyVolume() {
  if (gainNode) {
    gainNode.gain.value = isMuted ? 0 : volume
  }
  if (currentBGM && !bgmFadeTimer) {
    currentBGM.volume = isMuted ? 0 : volume * bgmVolume
  }
}

// 【重点修改】播放短音效：不用 new Audio，用内存里的 sfxBuffers
function play(name) {
  if (!isUnlocked) return
  if (isMuted && name !== 'bubble' && name !== 'tick') return
  
  if (name === 'bubble') {
    playTone(800, 0.05, 0.3)
    return
  }
  if (name === 'tick') {
    playTone(1000, 0.1, 0.2)
    return
  }

  if (soundMap[name]) {
    // 如果内存里有这个音效的数据
    if (sfxBuffers[name]) {
      const source = audioCtx.createBufferSource() // 创建轻量级播放源
      source.buffer = sfxBuffers[name]             // 绑定数据
      
      const sfxGain = audioCtx.createGain()        // 单独控制这个音效的音量
      sfxGain.gain.value = isMuted ? 0 : volume
      
      source.connect(sfxGain)
      sfxGain.connect(audioCtx.destination)
      source.start(0)                              // 立即播放，不抢通道！
    } else {
      // 兜底：万一还没预加载完，用老办法（可能会卡顿或冲突，但保证能响）
      const audio = new Audio(soundMap[name])
      audio.volume = isMuted ? 0 : volume
      audio.play().catch((err) => {
        console.warn(`[Audio] 兜底播放失败 ${name}:`, err.message)
      })
    }
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

// 背景音乐逻辑完全不动，它自己独占一个 new Audio 就好
function switchBGM(name) {
  if (!isUnlocked) return currentBGMKey
  if (bgmFadeTimer) {
    clearInterval(bgmFadeTimer); bgmFadeTimer = null
  }
  const doSwitch = () => {
    if (currentBGM) {
      currentBGM.pause(); currentBGM.src = ''; currentBGM = null
    }
    currentBGMKey = null
    if (name && soundMap[name]) {
      currentBGMKey = name
      currentBGM = new Audio(soundMap[name])
      currentBGM.loop = true
      currentBGM.volume = 0
      currentBGM.play().catch((err) => {
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
