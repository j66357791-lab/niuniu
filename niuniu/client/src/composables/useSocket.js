import { io } from 'socket.io-client'
import { ref } from 'vue'

let socket = null
let userId = null
let userName = null

const connected = ref(false)
const showReconnect = ref(false)

export function useSocket() {
  /** * 进入房间时调用，建立连接 * 必须传入 id 和 name，否则直接拦截（防止登录页误触发） */
  function connect(id, name) {
    // 防御：如果没有用户信息，绝对不建立连接
    if (!id || !name) return

    userId = id
    userName = name

    // 如果已经连接，直接返回
    if (socket?.connected) return

    // 如果 socket 实例不存在，创建一个
    if (!socket) {
      const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';
      socket = io(socketUrl, { withCredentials: true })
    }

    // 清除旧的监听器，防止重复绑定
    socket.off('connect').off('disconnect')

    socket.on('connect', () => {
      connected.value = true
      showReconnect.value = false // 连接成功，隐藏断线弹窗
      // 向后端发送认证信息
      socket.emit('auth', { userId, username: userName })
    })

    socket.on('disconnect', () => {
      connected.value = false
      // 只有认证过（有 userId）才显示重连弹窗
      if (userId) {
        showReconnect.value = true
      }
    })

    // 手动触发底层连接
    socket.connect()
  }

  /** 手动触发重连（用户点击“重新连接”按钮时调用） */
  function reconnect() {
    if (socket) {
      showReconnect.value = false // 先关掉弹窗，给用户“正在重连”的反馈
      socket.connect()
    }
  }

  /** 完全断开（退出登录、退回大厅时调用） */
  function disconnect() {
    if (socket) {
      socket.removeAllListeners()
      socket.disconnect()
      socket = null
    }
    userId = null
    userName = null
    connected.value = false
    showReconnect.value = false
  }

  function getSocket() {
    return socket
  }

  return { connected, showReconnect, connect, disconnect, reconnect, getSocket }
}
