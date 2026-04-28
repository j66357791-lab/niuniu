import { ref } from 'vue'

// 全局单例，所有组件共享同一份状态
const visible = ref(false)
const message = ref('')
const type = ref('error') // 'error' | 'success'
let timer = null

/**
 * 显示一个轻量 toast 提示
 * @param {string} msg  提示文本
 * @param {'error'|'success'} t  类型
 * @param {number} duration  持续毫秒数
 */
export function showToast(msg, t = 'error', duration = 2500) {
  if (timer) clearTimeout(timer)
  message.value = msg
  type.value = t
  visible.value = true
  timer = setTimeout(() => {
    visible.value = false
  }, duration)
}

export function useToast() {
  return { visible, message, type }
}
