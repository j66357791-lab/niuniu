import { Server as SocketIOServer } from 'socket.io'
import { registerBaseHandlers } from './baseHandler.js'

// 新增：模块级变量保存 io 实例
let io = null

/**
 * 初始化 Socket.IO，挂载到指定的 HTTP 服务器
 * @param {import('http').Server} httpServer
 */
export function initSocket(httpServer) {
  // 防止重复初始化
  if (io) return io

  io = new SocketIOServer(httpServer, {
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

// ✅ 新增：导出 getIO 供其他非 socket 上下文文件（如 transferController）使用
export function getIO() {
  if (!io) {
    throw new Error('Socket.IO 尚未初始化！请确保在 app.js 中调用了 initSocket(httpServer)')
  }
  return io
}
