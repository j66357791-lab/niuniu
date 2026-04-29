const cardImages = import.meta.glob('../assets/cards/*.png', { eager: true, query: '?url', import: 'default' })

export function getCardImage(cardName) {
  const key = `../assets/cards/card_${cardName}.png`
  return cardImages[key] || cardImages['../assets/cards/card_empty.png']
}

export function bullResultText(result) {
  if (!result) return ''
  if (result === 'bull_bull') return '牛牛'
  if (result === 'no_bull') return '无牛'
  const specialMap = { five_small: '五小牛', bomb: '炸弹', straight_flush: '同花顺', straight: '顺子' }
  if (specialMap[result]) return specialMap[result]
  const num = result.split('_')[1]
  const map = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七', '8': '八', '9': '九' }
  return `牛${map[num] || num}`
}

export function bullResultColor(result) {
  if (!result) return 'text-muted'
  if (['five_small', 'bomb', 'straight_flush', 'straight', 'bull_bull'].includes(result)) return 'text-gold'
  if (result === 'no_bull') return 'text-muted'
  return 'text-btn-green'
}
