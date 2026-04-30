import User from '../models/User.js'
import Transaction from '../models/Transaction.js'

/**
 * 服务端强制结算红包（不走 socket 事件，直接操作数据库）
 * 解决：玩家断线/离开时，socket 已断开导致 emit 失效，红包卡死的问题
 */
export async function forceSettleBox(io, room) {
  const box = room.currentBox
  
  // 防重入：如果已经结算过了，直接返回
  if (!box || box.isFinished) return

  // 1. 锁定状态，防止被多次触发
  box.isFinished = true
  
  // 2. 计算应该退还给发起人的金额 (remaining 是还没被抢走的钱)
  const refundAmount = box.remaining || 0

  if (refundAmount > 0) {
    try {
      // 查询发起人当前的积分
      const sponsor = await User.findById(box.sponsorId).select('score username').lean()
      if (sponsor) {
        const newScore = sponsor.score + refundAmount

        // 3. 数据库增加积分
        await User.updateOne(
          { _id: box.sponsorId }, 
          { $inc: { score: refundAmount } }
        )

        // 4. 写入流水记录（铁律：资金变动必须有流水）
        await Transaction.create({
          userId: box.sponsorId,
          type: 'box_refund',
          amount: refundAmount,
          balance_after: newScore,
          description: `红包未抢完，系统强制退回 ${refundAmount} 积分`
        })

        // 5. 实时推送最新积分给发起人（如果他重连了，能立刻收到最新余额）
        io.to(`user_${box.sponsorId}`).emit('score_sync', { newScore })
      }
    } catch (err) {
      console.error(`[红包结算异常] 房间${room.roomId}, 发起人${box.sponsorId}:`, err)
    }
  }

  // 6. 广播结算结果给房间里的其他人（复用前端已有的 box_opened 事件）
  io.to(`room_${room.roomId}`).emit('box_opened', {
    grabbedList: box.grabbedList,
    refund: refundAmount // 告诉前端退了多少钱
  })
}
