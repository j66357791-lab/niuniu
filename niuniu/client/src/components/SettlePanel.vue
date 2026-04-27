<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { getCardImage, bullResultText, bullResultColor } from '../utils/cards'

const props = defineProps({
  results: { type: Array, default: () => [] },
  autoCloseDelay: { type: Number, default: 5000 }
})

const emit = defineEmits(['close'])
const remaining = ref(props.autoCloseDelay / 1000)
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    remaining.value--
    if (remaining.value <= 0) {
      clearInterval(timer)
      emit('close')
    }
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function handleClose() {
  if (timer) clearInterval(timer)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="handleClose">
      <div class="card-panel w-full max-w-md mx-4 p-6 max-h-[85vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-gold font-bold text-lg tracking-wider">本 局 结 算</h3>
          <span class="text-xs text-muted">{{ remaining }}s 后关闭</span>
        </div>

        <div class="space-y-3">
          <div v-for="r in results" :key="r.userId"
               class="rounded-xl border p-4 transition-colors"
               :class="r.isBanker ? 'bg-gold/5 border-gold/30' : 'bg-table-bg border-table-border'">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-table-felt flex items-center justify-center text-sm font-bold text-gold-light">
                  {{ r.username.charAt(0) }}
                </div>
                <span class="text-ivory font-medium text-sm">{{ r.username }}</span>
                <span v-if="r.isBanker" class="text-[10px] bg-gold text-table-bg font-bold px-1.5 py-0.5 rounded">庄</span>
              </div>
              <span class="text-base font-bold"
                    :class="r.scoreChange > 0 ? 'text-btn-green' : r.scoreChange < 0 ? 'text-btn-red' : 'text-muted'">
                {{ r.scoreChange > 0 ? '+' : '' }}{{ r.scoreChange }}
              </span>
            </div>
            <div class="flex justify-center -space-x-5 mb-3">
              <img v-for="(card, ci) in r.hand" :key="ci"
                   :src="getCardImage(card)"
                   class="w-11 h-[60px] rounded-md shadow-md border border-white/10 object-cover relative"
                   :style="{ zIndex: ci }" />
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold" :class="bullResultColor(r.bullResult)">
                {{ bullResultText(r.bullResult) }}
              </span>
              <span class="text-xs text-muted">积分: {{ r.newTotal }}</span>
            </div>
          </div>
        </div>

        <button @click="handleClose" class="btn-primary mt-5">继 续</button>
      </div>
    </div>
  </Teleport>
</template>
