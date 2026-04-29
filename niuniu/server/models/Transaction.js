import mongoose from 'mongoose'

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['sys_add', 'sys_reduce', 'game_win', 'game_lose', 'transfer_out', 'transfer_in', 'fee']
  },
  amount: {
    type: Number,
    required: true
  },
  balance_after: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
})

export default mongoose.model('Transaction', transactionSchema)
