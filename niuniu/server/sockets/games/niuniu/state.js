/**
 * ==========================================
 * [牛牛专属状态层]
 * 职责：牛牛专属的数据格式化、断线重连状态补发
 * ==========================================
 */
import { rooms, playerStatusMap, findUserRoom, baseFormatRoomUpdate } from '../../baseState.js'

/**
 * 牛牛专属格式化（继承基础骨架，追加牛牛业务字段）
 */
export function formatRoomUpdate(room) {
  const base = baseFormatRoomUpdate(room)
  return {
    ...base,
    bankerId: room.bankerId,
    bankerDoubled: room.bankerDoubled || false,
    players: base.players.map(p => {
      const fullP = room.players.get(p.userId)
      return {
        ...p,
        betMultiplier: fullP?.betMultiplier || 0,
        hasRobbed: fullP?.hasRobbed || false,
        wantsRob: fullP?.wantsRob || false,
        hasShownDown: fullP?.hasShownDown || false
      }
    })
  }
}

/**
 * 清理红包定时器（牛牛专属业务）
 */
export function clearBoxTimer(room) {
  if (room.currentBox?.timer) {
    clearTimeout(room.currentBox.timer)
    room.currentBox.timer = null
  }
}

/**
 * 【核心】断线重连全量状态补发
 * 注意：这里修复了原版“暗牌阶段重连丢牌”的Bug
 */
export function sendFullGameState(socket, room, userId) {
  socket.emit('room_update', formatRoomUpdate(room))
  
  if (room.phase !== 'waiting') {
    socket.emit('phase_changed', { phase: room.phase, bankerId: room.bankerId, robbers: room.robbers })
  }

  const me = room.players.get(userId)
  if (!me) return

  if (room.deck.length > 0) {
    if (['dealing_hidden', 'robbing'].includes(room.phase)) {
      // 【Bug修复点】原版这里没有下发手牌，导致暗牌阶段断线重连玩家看不到牌
      if (me.role === 'player') {
        socket.emit('deal_cards_private', { privateCards: me.hand })
      }
    } 
    else if (room.phase === 'peasant_bet') {
      if (userId === room.bankerId) {
        const pub = []
        for (const [uid, p] of room.players) {
          if (uid !== room.bankerId && p.role !== 'spectator') pub.push({ userId: uid, publicCards: p.hand.slice(0, 3) })
        }
        if (pub.length) socket.emit('deal_cards', { players: pub })
      } else if (me.role === 'player') {
        socket.emit('deal_cards', { players: [{ userId, publicCards: me.hand.slice(0, 3) }] })
      }
    } 
    else if (['banker_double', 'playing', 'banker_playing'].includes(room.phase)) {
      const pub = []
      for (const [uid, p] of room.players) {
        if (p.role !== 'spectator') pub.push({ userId: uid, publicCards: p.hand.slice(0, 3) })
      }
      if (pub.length) socket.emit('deal_cards', { players: pub })
      
      // 这些阶段下发后两张暗牌
      if (me.role === 'player') socket.emit('deal_cards_private', { privateCards: me.hand.slice(3) })
    }
  }

  // 补发已经亮牌的玩家数据
  for (const [uid, p] of room.players) {
    if (p.hasShownDown && p.role !== 'spectator') {
      socket.emit('player_showdown', { userId: uid, privateCards: p.hand.slice(3), bullResult: p.bullResultObj })
    }
  }

  // 补发抢庄选择
  for (const [uid, p] of room.players) {
    if (p.hasRobbed) socket.emit('rob_choice_made', { userId: uid, wantsRob: p.wantsRob })
  }

  // 补发倒计时
  if (room.countdownSeconds > 0) socket.emit('countdown', { seconds: room.countdownSeconds, phase: room.phase })
}
