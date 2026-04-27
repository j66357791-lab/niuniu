import { io } from 'socket.io-client'
import { ref } from 'vue'

let socket = null
let userId = null
let userName = null

const connected = ref(false)
const showReconnect = ref(false)

export function useSocket() {
  function connect(id, name) {
    if (!id || !name) return
    userId = id
    userName = name

    if (socket?.connected) return

    if (!socket) {
      // 就改了下面这一行，去掉了写死的 localhost:4000
      const socketUrl = import.meta.env.VITE_SOCKET_URL || '';
      socket = io(socketUrl, {
        withCredentials: true
      })
    }

    socket.off('connect').off('disconnect')

    socket.on('connect', () => {
      connected.value = true
      showReconnect.value = false
      socket.emit('auth', { userId, username: userName })
    })

    socket.on('disconnect', () => {
      connected.value = false
      if (userId) {
        showReconnect.value = true
      }
    })

    socket.connect()
  }

  function reconnect() {
    if (socket) {
      showReconnect.value = false
      socket.connect()
    }
  }

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

  return {
    connected,
    showReconnect,
    connect,
    disconnect,
    reconnect,
    getSocket
  }
}
