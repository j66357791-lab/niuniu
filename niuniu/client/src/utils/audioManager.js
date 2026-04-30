let audioCtx = null
let gainNode = null
let isUnlocked = false
let currentBGM = null
let currentBGMKey = null
let bgmVolume = 1.0
let bgmFadeTimer = null
let volume = parseFloat(localStorage.getItem('audio_volume') || '0.5')
let isMuted = localStorage.getItem('audio_muted') === 'true'

// 【核心改动】专门用来存放短音效的“内存数据区”
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

// ==========================================
// 1. 初始化与解锁（必须在用户第一次点击时调用）
// ==========================================
function unlock() {
  if (isUnlocked) return
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    gainNode = audioCtx.createGain()
    gainNode.connect(audioCtx.destination)
  }
  if (audioCtx.state === 'suspended') audioCtx.resume()
  
  // 破冰：解除部分浏览器的首次播放封锁
  try {
    const iceBreaker = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=')
    iceBreaker.volume = 0
    iceBreaker.play().catch(() => {})
  } catch(e) {}
  
  isUnlocked = true
  document.removeEventListener('click', unlock)
  document.removeEventListener('touchstart', unlock)
  
  // 【关键】解锁后，立刻在后台静默下载短音效到内存
  preloadSFX()
}

// ==========================================
// 2. 预加载短音效（转二进制存入内存，播放时 0 延迟且不抢通道）
// ==========================================
async function preloadSFX() {
  if (!audioCtx) return
  for (const [name, url] of Object.entries(soundMap)) {
    // 背景音乐比较大，不走内存预加载，直接用 HTML5 Audio 流式播放
    if (name.startsWith('backend')) continue 
    
    try {
      const response = await fetch(url)
      // 如果报错 404，这里会直接拦住并告诉你
      if (!response.ok) {
        console.error(`[Audio] 预加载失败 ${name}: HTTP ${response.status} (请检查 public/audio/ 下有没有这个文件！)`)
        continue
      }
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      sfxBuffers[name] = audioBuffer // 存进内存
    } catch (err) {
      console.error(`[Audio] 解析失败 ${name}:`, err.message)
    }
  }
}

// ==========================================
// 3. 音量与静音控制
// ==========================================
function applyVolume() {
  if (gainNode) {
    gainNode.gain.value = isMuted ? 0 : volume
  }
  if (currentBGM && !bgmFadeTimer) {
    currentBGM.volume = isMuted ? 0 : volume * bgmVolume
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

// ==========================================
// 4. 播放短音效（绝对安全，绝对不会卡断背景音乐）
// ==========================================
function play(name) {
  if (!isUnlocked) return
  if (isMuted && name !== 'bubble' && name !== 'tick') return
  
  // 虚拟音效（聊天气泡、倒计时滴答）
  if (name === 'bubble') {
    playTone(800, 0.05, 0.3)
    return
  }
  if (name === 'tick') {
    playTone(1000, 0.1, 0.2)
    return
  }

  // 【核心逻辑】只从内存里取数据播放
  if (sfxBuffers[name]) {
    const source = audioCtx.createBufferSource()
    source.buffer = sfxBuffers[name]
    
    const sfxGain = audioCtx.createGain()
    sfxGain.gain.value = isMuted ? 0 : volume
    
    source.connect(sfxGain)
    sfxGain.connect(audioCtx.destination)
    source.start(0) // 立即播放，不抢通道！
  } else {
    // 如果走到这里，说明预加载失败了（文件没找到）。直接放弃，绝不使用 new Audio 兜底！
  }
}

// 生成虚拟音效
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

// ==========================================
// 5. 背景音乐（保持原有淡入淡出和循环逻辑）
// ==========================================
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
      currentBGM.loop = true // 循环播放
      currentBGM.volume = 0  // 从 0 开始淡入
      
      currentBGM.play().catch((err) => {
        // 如果走到这里报错，100% 是因为找不到音频文件（拿到了 HTML 页面）
        console.error(`[BGM失败] 名字:${name}, 路径:${soundMap[name]}, 原因:`, err.message)
        currentBGMKey = null
      })
      
      // 淡入动画
      let v = 0
      bgmFadeTimer = setInterval(() => {
        v += 0.05
        if (v >= bgmVolume) { v = bgmVolume; clearInterval(bgmFadeTimer); bgmFadeTimer = null }
        currentBGM.volume = isMuted ? 0 : v * volume
      }, 50)
    }
    return currentBGMKey
  }

  // 如果当前有音乐在播，先淡出再切换
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

// ==========================================
// 6. 导出
// ==========================================
export const audioManager = {
  play,
  switchBGM,
  setVolume,
  toggleMute,
  get volume() { return volume },
  get isMuted() { return isMuted },
  get currentBGMName() { return currentBGMKey }
}
