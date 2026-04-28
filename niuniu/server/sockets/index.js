import { Server as SocketIOServer } from 'socket.io'
import { registerBaseHandlers } from './baseHandler.js'

/**
 * 初始化 Socket.IO，挂载到指定的 HTTP 服务器
 * @param {import('http').Server} httpServer
 */
export function initSocket(httpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  })

  io.on('connection', (socket) => {
    console.log(`[Socket] 新连接: ${socket.id}`)

    // 心跳响应，配合前端 latency 监控
    socket.on('ping', () => {
      socket.emit('pong')
    })

    // 委托给基础事件处理器（auth、disconnect、create_room 等）
    registerBaseHandlers(io, socket)

    // 游戏专属事件由 baseHandler 在加入房间时动态挂载，此处无需额外处理
  })

  return io
}