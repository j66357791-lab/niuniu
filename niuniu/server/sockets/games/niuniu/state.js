import mongoose from 'mongoose'

export const rooms = new Map()
export const playerStatusMap = new Map()

export function findUserRoom(userId) {
  for (const room of rooms.values()) { if (room.players.has(userId)) return room }
  return null
}

export function formatRoomUpdate(room) {
  return {
    roomId: room.roomId, ownerId: room.ownerId, phase: room.phase, bankerId: room.bankerId,
    maxPlayers: room.maxPlayers, baseScore: room.baseScore, bankerDoubled: room.bankerDoubled || false,
    players: Array.from(room.players.values()).map(p => ({ 
      userId: p.userId, username: p.username, isReady: p.isReady, offline: !!p.offline, 
      role: p.role || 'player', betMultiplier: p.betMultiplier || 0,
      hasRobbed: p.hasRobbed || false, wantsRob: p.wantsRob || false,
      hasShownDown: p.hasShownDown || false
    }))
  }
}

export function clearAllTimers(room) {
  if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null }
  if (room.robAnimTimer) { clearTimeout(room.robAnimTimer); room.robAnimTimer = null }
  if (room.dealTimer) { clearTimeout(room.dealTimer); room.dealTimer = null }
  if (room.settleTimer) { clearTimeout(room.settleTimer); room.settleTimer = null }
}

// 【新增】：清理箱子倒计时
export function clearBoxTimer(room) {
  if (room.currentBox?.timer) { clearTimeout(room.currentBox.timer); room.currentBox.timer = null }
}

export function removeUserFromRoom(io, room, userId) {
  room.players.delete(userId)
  playerStatusMap.set(userId, 'idle')
  if (room.players.size === 0) { clearAllTimers(room); rooms.delete(room.roomId); return }
  if (room.ownerId === userId) room.ownerId = room.players.values().next().value.userId
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
}

export function sendFullGameState(socket, room, userId) {
  socket.emit('room_update', formatRoomUpdate(room))
  if (room.phase !== 'waiting') socket.emit('phase_changed', { phase: room.phase, bankerId: room.bankerId, robbers: room.robbers })
  
  if (room.deck.length > 0) {
    const me = room.players.get(userId)
    if (!me) return

    if (['dealing_hidden', 'robbing'].includes(room.phase)) {
      // 全暗牌，不发任何牌数据
    } else if (room.phase === 'peasant_bet') {
      if (userId === room.bankerId) {
        const pub = []
        for (const [uid, p] of room.players) { if (uid !== room.bankerId && p.role !== 'spectator') pub.push({ userId: uid, publicCards: p.hand.slice(0, 3) }) }
        if (pub.length) socket.emit('deal_cards', { players: pub })
      } else if (me.role === 'player') {
        socket.emit('deal_cards', { players: [{ userId, publicCards: me.hand.slice(0, 3) }] })
      }
    } else if (['banker_double', 'playing', 'banker_playing'].includes(room.phase)) {
      const pub = []
      for (const [uid, p] of room.players) { if (p.role !== 'spectator') pub.push({ userId: uid, publicCards: p.hand.slice(0, 3) }) }
      if (pub.length) socket.emit('deal_cards', { players: pub })
    }

    if (me.role === 'player') socket.emit('deal_cards_private', { privateCards: me.hand.slice(3) })
    
    for (const [uid, p] of room.players) {
      if (p.hasShownDown && p.role !== 'spectator') socket.emit('player_showdown', { userId: uid, privateCards: p.hand.slice(3), bullResult: p.bullResultObj })
    }
  }
  for (const [uid, p] of room.players) { if (p.hasRobbed) socket.emit('rob_choice_made', { userId: uid, wantsRob: p.wantsRob }) }
  if (room.countdownSeconds > 0) socket.emit('countdown', { seconds: room.countdownSeconds, phase: room.phase })
}
