/**
 * ==========================================
 * [全局基础状态层] 
 * 职责：管理内存中的房间池、玩家在线状态、通用房间操作
 * 注意：这里绝对不能出现任何具体游戏（如牛牛）的业务字段
 * ==========================================
 */

// 全局房间池
export const rooms = new Map()

// 全局玩家状态池 (idle | in_game)
export const playerStatusMap = new Map()

/**
 * 查找玩家当前所在的房间
 */
export function findUserRoom(userId) {
  for (const room of rooms.values()) {
    if (room.players.has(userId)) return room
  }
  return null
}

/**
 * 基础房间信息格式化（只包含最核心的房间骨架）
 * 用于：踢人、异常离开等不需要知道具体游戏状态的场景
 */
export function baseFormatRoomUpdate(room) {
  return {
    roomId: room.roomId,
    ownerId: room.ownerId,
    phase: room.phase,
    maxPlayers: room.maxPlayers,
    baseScore: room.baseScore,
    players: Array.from(room.players.values()).map(p => ({
      userId: p.userId,
      username: p.username,
      isReady: p.isReady,
      offline: !!p.offline,
      role: p.role || 'player'
    }))
  }
}

/**
 * 清理房间所有通用定时器
 */
export function clearAllTimers(room) {
  if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null }
  if (room.robAnimTimer) { clearTimeout(room.robAnimTimer); room.robAnimTimer = null }
  if (room.dealTimer) { clearTimeout(room.dealTimer); room.dealTimer = null }
  if (room.settleTimer) { clearTimeout(room.settleTimer); room.settleTimer = null }
}

/**
 * 将玩家从房间移除（通用逻辑）
 */
export function removeUserFromRoom(io, room, userId) {
  room.players.delete(userId)
  playerStatusMap.set(userId, 'idle')
  
  if (room.players.size === 0) {
    clearAllTimers(room)
    rooms.delete(room.roomId)
    return
  }
  
  if (room.ownerId === userId) room.ownerId = room.players.values().next().value.userId
  
  // 注意这里使用的是 baseFormatRoomUpdate，因为这是底层基础操作
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
  io.to(`room_${room.roomId}`).emit('room_update', baseFormatRoomUpdate(room))
}
