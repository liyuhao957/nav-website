const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const Link = require('./models/Link');
const app = express();

// 连接 MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

app.use(cors());
app.use(express.json());

// API 路由
app.get('/api/links', async (req, res) => {
  try {
    const links = await Link.find();
    // 将数据转换为原来的格式
    const groupedLinks = links.reduce((acc, link) => {
      if (!acc[link.category]) {
        acc[link.category] = [];
      }
      acc[link.category].push({
        title: link.title,
        url: link.url,
        description: link.description
      });
      return acc;
    }, {});
    res.json(groupedLinks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/links', async (req, res) => {
  try {
    const { category, link } = req.body;
    await Link.create({
      category,
      title: link.title,
      url: link.url,
      description: link.description
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 其他路由类似修改...

module.exports = app; 