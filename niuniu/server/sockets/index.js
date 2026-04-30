//初始化通信通道并分发事件

import { Server as SocketIOServer } from 'socket.io'
import { registerBaseHandlers } from './baseHandler.js'
// ✅ 新增：引入牛牛游戏专属事件处理器
import { niuniuHandler } from './games/niuniu/handler.js'

// 模块级变量保存 io 实例
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

    // 心跳响应
    socket.on('ping', () => {
      socket.emit('pong')
    })

    // 1. 挂载基础事件（进房、出房、红包、聊天等）
    registerBaseHandlers(io, socket)
    
    // ✅ 2. 挂载牛牛核心玩法事件（准备、抢庄、下注、亮牌等）
    niuniuHandler(socket, io)
  })

  return io
}

// 导出 getIO 供其他文件使用
export function getIO() {
  if (!io) {
    throw new Error('Socket.IO 尚未初始化！请确保在 app.js 中调用了 initSocket(httpServer)')
  }
  return io
}
