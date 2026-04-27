/**
 * 扑克牌工具模块
 * 通过 import.meta.glob 建立牌名 → 图片路径的映射表
 */

const cardImages = import.meta.glob('../assets/cards/*.png', { eager: true, query: '?url', import: 'default' })

/**
 * 根据后端传来的牌字符串获取图片路径
 * @param {string} cardName  如 "hearts_A"、"card_back"、"card_empty"
 * @returns {string} 图片 URL
 */
export function getCardImage(cardName) {
  const key = `../assets/cards/card_${cardName}.png`
  return cardImages[key] || cardImages['../assets/cards/card_empty.png']
}

/**
 * 牌型结果转中文显示
 * @param {string} result  如 "bull_8"、"bull_bull"、"no_bull"
 * @returns {string}
 */
export function bullResultText(result) {
  if (result === 'bull_bull') return '牛牛'
  if (result === 'no_bull') return '无牛'
  const num = result.split('_')[1]
  const map = {
    '1': '一', '2': '二', '3': '三', '4': '四',
    '5': '五', '6': '六', '7': '七', '8': '八', '9': '九'
  }
  return `牛${map[num] || num}`
}

/**
 * 牌型对应的文字颜色 class
 */
export function bullResultColor(result) {
  if (result === 'bull_bull') return 'text-gold'
  if (result === 'no_bull') return 'text-muted'
  return 'text-btn-green'
}
