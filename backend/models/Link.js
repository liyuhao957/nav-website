const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
  category: String,
  title: String,
  url: String,
  description: String
});

module.exports = mongoose.model('Link', linkSchema); 