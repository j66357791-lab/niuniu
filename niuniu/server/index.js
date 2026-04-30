import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import { httpServer } from './app.js'

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/niuniu'

mongoose
  .connect(mongoURI)
  .then(() => {
    console.log('✅ MongoDB 连接成功')
    
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
