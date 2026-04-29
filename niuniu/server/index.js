import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import User from './models/User.js'
import bcrypt from 'bcryptjs'
import { httpServer } from './app.js'   // 导入而未启动

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/niuniu'

mongoose
  .connect(mongoURI)
  .then(async () => {
    console.log('✅ MongoDB 连接成功')
    await initAdmin()

    // 数据库就绪后，启动 HTTP + WebSocket 服务
    const PORT = process.env.PORT || 4000
    httpServer.listen(PORT, () => {
      console.log(`🚀 服务器已启动: http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('❌ MongoDB 连接失败:', err.message)
    process.exit(1)
  })

async function initAdmin() {
  try {
    const admin = await User.findOne({ role: 'admin' })
    if (!admin) {
      const hash = await bcrypt.hash('628727', 10)
      await User.create({
        username: '18679012034',
        phone: '18679012034',
        password: hash,
        role: 'admin',
        score: 0
      })
      console.log('🛡️ 默认管理员已初始化 (账号/手机: 18679012034)')
    }
  } catch (err) {
    console.error('初始化管理员失败:', err)
  }
}