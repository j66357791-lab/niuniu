import { rooms, playerStatusMap, findUserRoom, baseFormatRoomUpdate, clearAllTimers, removeUserFromRoom } from './baseState.js'
import User from '../models/User.js'
// 【已删除】危险引入：import { forceSettleBox } from '../services/boxService.js'

/**
 * ==========================================
 * [架构核心] 游戏插件注册表 (万能插座)
 * ==========================================
 */
const gameRegistry = new Map()

export function registerGame(gameType, formatFn, fullStateFn, offlineFn) {
  gameRegistry.set(gameType, { formatUpdate: formatFn, sendFullState: fullStateFn, handleOffline: offlineFn })
}

// 内部工具：获取当前房间绑定的游戏插件
function getPlugin(room) {
  return room ? gameRegistry.get(room.gameType) : null
}

/**
 * ==========================================
 * [核心注册函数] 基础房间事件
 * ==========================================
 */
export function registerBaseHandlers(io, socket) {
  // 1. 身份认证
  socket.on('auth', ({ userId, username }) => {
    socket.data.userId = userId
    socket.data.username = username
    if (!playerStatusMap.has(userId)) playerStatusMap.set(userId, 'idle')
    socket.join(`user_${userId}`)
  })

  // 2. 创建房间 (兼容处理：前端不传 gameType 默认为 niuniu)
  socket.on('create_room', async ({ password, maxPlayers, baseScore, gameType }, callback) => {
    const userId = socket.data.userId
    const username = socket.data.username
    if (!userId) return callback?.({ ok: false, msg: '未认证' })
    if (!password || password.length < 4) return callback?.({ ok: false, msg: '密码至少4位' })
    if (playerStatusMap.get(userId) === 'in_game') {
      const stuckRoom = findUserRoom(userId)
      return callback?.({ ok: false, code: 'IN_GAME_REDIRECT', msg: `您在房间 ${stuckRoom?.roomId} 还有未完成的对局`, roomId: stuckRoom?.roomId })
    }

    let score = 0
    try {
      const u = await User.findById(userId).select('score').lean()
      if (u) score = u.score
    } catch (e) {}

    if (score < 100) return callback?.({ ok: false, msg: '积分不足100，无法创建房间' })

    const prev = findUserRoom(userId)
    if (prev) {
      socket.leave(`room_${prev.roomId}`)
      removeUserFromRoom(io, prev, userId)
    }

    let roomId
    do {
      roomId = String(Math.floor(1000 + Math.random() * 9000))
    } while (rooms.has(roomId))

    const mp = parseInt(maxPlayers) || 4
    const bs = parseInt(baseScore) || 10
    if (![10, 30, 50, 100].includes(bs)) return callback?.({ ok: false, msg: '底分档位不正确' })

    const currentGameType = gameType || 'niuniu' // 向下兼容

    const room = {
      roomId,
      gameType: currentGameType,
      password,
      ownerId: userId,
      phase: 'waiting',
      deck: [],
      bankerId: '',
      maxPlayers: mp,
      baseScore: bs,
      currentBox: null,
      countdownTimer: null,
      robAnimTimer: null,
      dealTimer: null,
      settleTimer: null,
      countdownSeconds: 0,
      players: new Map([[
        userId, {
          userId, username, socketId: socket.id,
          isReady: false, hand: [], offline: false, roundScore: 0, score,
          role: 'player', hasRobbed: false, wantsRob: false,
          bullResult: null, bullResultObj: null, hasShownDown: false,
          betMultiplier: 0, offlineTimer: null
        }
      ]])
    }

    rooms.set(roomId, room)
    socket.join(`room_${roomId}`)

    const plugin = getPlugin(room)
    if (plugin?.formatUpdate) io.to(`room_${roomId}`).emit('room_update', plugin.formatUpdate(room))
    callback?.({ ok: true, roomId })
  })

  // 3. 加入房间
  socket.on('join_room', async ({ roomId, password }, callback) => {
    const userId = socket.data.userId
    const username = socket.data.username
    if (!userId) return callback?.({ ok: false, msg: '未认证' })
    if (playerStatusMap.get(userId) === 'in_game') {
      const stuckRoom = findUserRoom(userId)
      return callback?.({ ok: false, code: 'IN_GAME_REDIRECT', msg: `您在房间 ${stuckRoom?.roomId} 还有未完成的对局`, roomId: stuckRoom?.roomId })
    }

    const room = rooms.get(roomId)
    if (!room) return callback?.({ ok: false, msg: '房间不存在' })

    // 重连逻辑：动态调用对应游戏的全量补发
    if (room.players.has(userId)) {
      callback?.({ ok: true })
      const plugin = getPlugin(room)
      if (plugin?.sendFullState) plugin.sendFullState(socket, room, userId)
      return
    }

    if (room.password !== password) return callback?.({ ok: false, msg: '房间密码错误' })

    const isSpectator = room.phase !== 'waiting'
    if (!isSpectator && room.players.size >= room.maxPlayers) return callback?.({ ok: false, msg: '房间已满' })

    let score = 0
    try {
      const u = await User.findById(userId).select('score').lean()
      if (u) score = u.score
    } catch (e) {}

    if (!isSpectator && score < 100) return callback?.({ ok: false, msg: '积分不足100，无法加入该房间' })

    const prev = findUserRoom(userId)
    if (prev) {
      socket.leave(`room_${prev.roomId}`)
      removeUserFromRoom(io, prev, userId)
    }

    room.players.set(userId, {
      userId, username, socketId: socket.id,
      isReady: false, hand: [], offline: false, roundScore: 0, score,
      role: isSpectator ? 'spectator' : 'player', hasRobbed: false, wantsRob: false,
      bullResult: null, bullResultObj: null, hasShownDown: false,
      betMultiplier: 0, offlineTimer: null
    })

    socket.join(`room_${roomId}`)
    io.to(`room_${room.roomId}`).emit('room_notice', {
      message: `欢迎 ${username} ${isSpectator ? '观战' : '加入'}房间`,
      ownerName: room.players.get(room.ownerId)?.username
    })

    callback?.({ ok: true, isSpectator })

    const plugin = getPlugin(room)
    if (plugin?.formatUpdate) io.to(`room_${room.roomId}`).emit('room_update', plugin.formatUpdate(room))
    if (isSpectator && plugin?.sendFullState) plugin.sendFullState(socket, room, userId)
  })

  // 4. 断线重连
  socket.on('reconnect_room', ({ userId }, callback) => {
    const room = findUserRoom(userId)
    if (!room) return callback?.({ ok: false, action: 'lobby' })
    const p = room.players.get(userId)
    if (!p) return callback?.({ ok: false, action: 'lobby' })

    if (p.offlineTimer) {
      clearTimeout(p.offlineTimer)
      p.offlineTimer = null
    }

    socket.data.userId = userId
    socket.data.username = p.username
    p.socketId = socket.id
    p.offline = false
    socket.join(`room_${room.roomId}`)
    socket.join(`user_${userId}`)

    callback?.({ ok: true, action: 'stay' })

    const plugin = getPlugin(room)
    if (plugin?.sendFullState) plugin.sendFullState(socket, room, userId)
  })

  // 5. 主动离开房间
  socket.on('leave_room', () => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room) return
    
    socket.leave(`room_${room.roomId}`)
    
    // 【恢复稳定逻辑】尝试触发内部事件，如果玩家网络正常则立即结算；如果断线了发不出，则交给60秒超时兜底
    if (room.currentBox && !room.currentBox.isFinished) {
      socket.emit('__force_settle_box')
    }

    if (room.phase !== 'waiting') {
      const p = room.players.get(userId)
      if (p) {
        p.offline = true
        const plugin = getPlugin(room)
        if (plugin?.handleOffline) plugin.handleOffline(io, room, userId, room.phase)
        if (plugin?.formatUpdate) io.to(`room_${room.roomId}`).emit('room_update', plugin.formatUpdate(room))
      }
      return
    }

    room.players.delete(userId)
    playerStatusMap.set(userId, 'idle')
    if (room.players.size === 0) {
      clearAllTimers(room)
      rooms.delete(room.roomId)
      return
    }
    if (room.ownerId === userId) room.ownerId = room.players.values().next().value.userId
    io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
    const plugin = getPlugin(room)
    if (plugin?.formatUpdate) io.to(`room_${room.roomId}`).emit('room_update', plugin.formatUpdate(room))
  })

  // 6. 异常断开连接
  socket.on('disconnect', () => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room) return
    
    socket.leave(`room_${room.roomId}`)
    
    // 【恢复稳定逻辑】断线时发不出事件无所谓，handler.js 里的 60000 毫秒定时器会自动兜底结算退款
    if (room.currentBox && !room.currentBox.isFinished) {
      socket.emit('__force_settle_box')
    }

    if (room.phase === 'waiting') {
      room.players.delete(userId)
      playerStatusMap.set(userId, 'idle')
      if (room.players.size === 0) {
        clearAllTimers(room)
        rooms.delete(room.roomId)
        return
      }
      if (room.ownerId === userId) room.ownerId = room.players.values().next().value.userId
      io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
      const plugin = getPlugin(room)
      if (plugin?.formatUpdate) io.to(`room_${room.roomId}`).emit('room_update', plugin.formatUpdate(room))
      return
    }

    const p = room.players.get(userId)
    if (p) {
      p.offline = true
      if (p.offlineTimer) clearTimeout(p.offlineTimer)
      p.offlineTimer = setTimeout(() => {
        if (!room.players.has(userId)) return
        room.players.delete(userId)
        playerStatusMap.set(userId, 'idle')
        io.to(`room_${room.roomId}`).emit('room_notice', { message: `${p.username} 掉线超时，已移出房间` })
        const plugin = getPlugin(room)
        if (plugin?.formatUpdate) io.to(`room_${room.roomId}`).emit('room_update', plugin.formatUpdate(room))
        if (room.phase === 'waiting' && room.players.size === 0) {
          clearAllTimers(room)
          rooms.delete(room.roomId)
        }
      }, 60000)

      const plugin = getPlugin(room)
      if (plugin?.handleOffline) {
        plugin.handleOffline(io, room, userId, room.phase)
      }
      if (plugin?.formatUpdate) io.to(`room_${room.roomId}`).emit('room_update', plugin.formatUpdate(room))
    }
  })

  // 7. 聊天气泡
  socket.on('chat_bubble', ({ bubbleId }) => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room) return
    socket.to(`room_${room.roomId}`).emit('chat_bubble', { userId, username: socket.data.username, bubbleId })
  })
}
