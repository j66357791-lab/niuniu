<script setup>
import { computed } from 'vue'
import { getCardImage, bullResultText, bullResultColor } from '../utils/cards'

const props = defineProps({
  results: { type: Array, required: true }
})

const emit = defineEmits(['close'])

const sortedResults = computed(() => {
  return [...props.results].sort((a, b) => (b.isBanker ? 1 : 0) - (a.isBanker ? 1 : 0))
})
</script>

<template>
  <Teleport to="body">
    <!-- z-[9999] 确保层级绝对最高，绝对不加 @click.stop -->
    <div class="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" @click.self="emit('close')">
      <div class="bg-card-panel rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col border border-table-border/50 shadow-2xl overflow-hidden">
        <!-- 头部 -->
        <div class="px-6 py-4 border-b border-table-border/30 flex items-center justify-between shrink-0">
          <h3 class="text-gold font-bold text-lg">对局结算</h3>
          <button @click="emit('close')" class="text-muted hover:text-ivory transition-colors cursor-pointer bg-transparent border-none text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-table-bg">
            ✕
          </button>
        </div>

        <!-- 玩家列表 -->
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <div v-for="r in sortedResults" :key="r.userId" 
               class="rounded-xl p-4 transition-all"
               :class="r.isBanker ? 'bg-gold/10 border border-gold/30' : 'bg-table-bg/50 border border-table-border/30'">
            
            <!-- 玩家信息行 -->
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span v-if="r.isBanker" class="text-lg">👑</span>
                <span class="text-ivory font-semibold">{{ r.username }}</span>
              </div>
              <span class="text-base font-bold font-mono tabular-nums"
                    :class="r.scoreChange > 0 ? 'text-btn-green' : r.scoreChange < 0 ? 'text-btn-red' : 'text-muted'">
                {{ r.scoreChange > 0 ? '+' : '' }}{{ r.scoreChange.toFixed(2) }}
              </span>
            </div>

            <!-- 牌型展示 -->
            <div class="flex items-center gap-1 mb-2">
              <span class="text-sm font-bold"
                    :class="r.bullResult?.type === 'no_bull' ? 'no-bull-text' : bullResultColor(r.bullResult?.result)">
                {{ bullResultText(r.bullResult?.result) }}
              </span>
              <span class="text-muted text-xs">余额: {{ r.newTotal.toFixed(2) }}</span>
            </div>

            <!-- 5张牌展示 -->
            <div class="flex flex-wrap gap-1.5 justify-center">
              <div v-for="(card, ci) in (r.hand || [])" :key="ci" class="w-10 h-14 sm:w-11 sm:h-[60px] shrink-0">
                <img :src="getCardImage(card)" class="w-full h-full rounded-lg shadow-md border border-white/20 object-cover" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.no-bull-text {
  color: #7a8a7e !important;
  font-weight: 800;
  text-shadow: 
    1px 1px 0 rgba(0,0,0,0.9), 
    -1px -1px 0 rgba(0,0,0,0.9), 
    1px -1px 0 rgba(0,0,0,0.9), 
    -1px 1px 0 rgba(0,0,0,0,9), 
    0 0 6px rgba(0,0,0,0.5);
}
</style>
