export function createDeck() {
  const s = ['hearts', 'diamonds', 'clubs', 'spades'], v = ['A', '02', '03', '04', '05', '06', '07', '08', '09', '10', 'J', 'Q', 'K'], d = []
  for (const su of s) for (const va of v) d.push(`${su}_${va}`)
  return d
}

export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

export function getCardPoint(c) {
  const v = c.split('_')[1]
  if (v === 'A') return 1
  if (['J', 'Q', 'K'].includes(v)) return 10
  return parseInt(v)
}

// 用于判断顺子的数值，A算1
function getCardValue(c) {
  const v = c.split('_')[1]
  if (v === 'A') return 1
  if (v === 'J') return 11
  if (v === 'Q') return 12
  if (v === 'K') return 13
  return parseInt(v)
}

function getCardSuit(c) { return c.split('_')[0] }

/**
 * 检查特殊牌型，返回 { type: string, rank: number }
 * rank 越大牌型越大
 */
function checkSpecialType(hand) {
  const points = hand.map(getCardPoint).sort((a, b) => a - b)
  const total = points.reduce((s, p) => s + p, 0)

  // 五小牛：5张牌都小于5，且总和小于等于10
  if (points.every(p => p < 5) && total <= 10) {
    return { type: 'five_small', rank: 50 }
  }

  const values = hand.map(getCardValue).sort((a, b) => a - b)
  const suits = hand.map(getCardSuit)

  // 炸弹：四张点数相同
  const counts = {}
  values.forEach(v => counts[v] = (counts[v] || 0) + 1)
  if (Object.values(counts).includes(4)) {
    return { type: 'bomb', rank: 40 }
  }

  // 同花顺：同花色 + 连续 (包含 10-J-Q-K-A 和 A-2-3-4-5)
  const isFlush = suits.every(s => s === suits[0])
  let isStraight = true
  for (let i = 1; i < 5; i++) { if (values[i] !== values[i - 1] + 1) { isStraight = false; break } }
  // A-2-3-4-5 特殊顺子
  const isA2345 = values[0] === 1 && values[1] === 2 && values[2] === 3 && values[3] === 4 && values[4] === 5

  if (isFlush && (isStraight || isA2345)) {
    return { type: 'straight_flush', rank: 30 }
  }

  // 普通顺子
  if (isStraight || isA2345) {
    return { type: 'straight', rank: 20 }
  }

  return null
}

/**
 * 计算牌型，返回 { result: string, rank: number, type: string }
 * result: 'bull_bull', 'bull_1'~'bull_9', 'no_bull', 'five_small', 'bomb', 'straight_flush', 'straight'
 */
export function calculateBull(hand) {
  // 1. 优先判断特殊牌型（五小牛、炸弹、同花顺等），有就直接返回
  const special = checkSpecialType(hand)
  if (special) {
    return { result: special.type, rank: special.rank, type: special.type }
  }

  // 2. 普通算牛逻辑：【已修复】遍历所有组合，取最大的牛
  let maxBullRank = 0 // 记录找到的最大牛等级

  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      for (let k = j + 1; k < 5; k++) {
        if ((getCardPoint(hand[i]) + getCardPoint(hand[j]) + getCardPoint(hand[k])) % 10 === 0) {
          // 找到凑10的组合，计算剩下两张牌
          const r = []
          for (let m = 0; m < 5; m++) {
            if (m !== i && m !== j && m !== k) r.push(hand[m])
          }
          
          // 算出剩下两张的牛数（如果是0则代表牛牛，即10）
          const s = (getCardPoint(r[0]) + getCardPoint(r[1])) % 10 === 0 ? 10 : (getCardPoint(r[0]) + getCardPoint(r[1])) % 10
          
          // 如果当前组合的牛比之前记录的大，则更新最大值
          if (s > maxBullRank) {
            maxBullRank = s
          }
        }
      }
    }
  }

  // 3. 10种组合全部遍历完毕，根据最大牛等级返回最终结果
  if (maxBullRank > 0) {
    if (maxBullRank === 10) return { result: 'bull_bull', rank: 10, type: 'bull_bull' }
    return { result: `bull_${maxBullRank}`, rank: maxBullRank, type: 'bull' }
  }

  return { result: 'no_bull', rank: 0, type: 'no_bull' }
}

/**
 * 获取牌型对应的倍率
 */
export function getBullMultiplier(bullResult) {
  if (['five_small', 'bomb', 'straight_flush', 'straight'].includes(bullResult.type)) return 5
  if (bullResult.type === 'bull_bull') return 4
  if (bullResult.rank === 9) return 3
  if (bullResult.rank >= 7) return 2
  return 1
}

export function calculateGameResults(room) {
  const banker = room.players.get(room.bankerId)
  const bankerBull = banker.bullResultObj
  const bMultiplier = getBullMultiplier(bankerBull)
  
  const results = []
  let bankerDelta = 0

  for (const [uid, p] of room.players) {
    if (uid === room.bankerId || p.role === 'spectator') continue

    const pMultiplier = getBullMultiplier(p.bullResultObj)
    const maxMult = Math.max(pMultiplier, bMultiplier)
    
    // 总倍率 = 底分 × 闲家下注倍数 × 庄家是否加倍(1或2) × 牌型倍率
    const betMult = p.betMultiplier || 1
    const bankerDoubleMult = room.bankerDoubled ? 2 : 1
    const totalMult = betMult * bankerDoubleMult * maxMult
    
    let change = p.bullResultObj.rank > bankerBull.rank 
      ? room.baseScore * totalMult 
      : -room.baseScore * totalMult

    // 防负数兜底
    if (change < 0 && Math.abs(change) > p.roundScore) {
      change = -p.roundScore
    }

    bankerDelta -= change
    results.push({ userId: uid, username: p.username, hand: p.hand, bullResult: p.bullResultObj, scoreChange: change, isBanker: false, newTotal: p.roundScore + change })
  }

  // 庄家结算
  let bChange = bankerDelta
  if (bChange < 0 && Math.abs(bChange) > banker.roundScore) bChange = -banker.roundScore
  
  results.push({
    userId: room.bankerId, username: banker.username, hand: banker.hand, bullResult: banker.bullResultObj,
    scoreChange: bChange, isBanker: true, newTotal: banker.roundScore + bChange
  })
  
  return results
}
