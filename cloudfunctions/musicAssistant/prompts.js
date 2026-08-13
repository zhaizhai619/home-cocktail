const SONG_PROFILE_PROMPT_VERSION = 'song-profile-v1'
const COCKTAIL_PROFILE_PROMPT_VERSION = 'cocktail-profile-v1'
const NAMING_PROMPT_VERSION = 'cocktail-naming-v1'

const COCKTAIL_MATERIAL_GUIDE = `材料和用量只是联想参考，请综合整杯酒判断：
- 用量较大的材料通常更影响主体；少量辣椒、苦精、烟熏等高强度材料也可能很突出。
- 金酒常偏清冷、干爽、草本；威士忌和陈年深色烈酒常偏成熟、厚重、木质；伏特加和白朗姆较随和、易融入果味；龙舌兰常偏鲜明、植物感和辛辣。
- 气泡常带来轻快、清爽；奶制品、百利甜和蛋清常带来柔和、绵密；高糖和复合果味常更明艳外放。
- 黄瓜、晴王等容易产生青绿、清凉、自然联想。
- 短饮和高酒精度常偏干练犀利；长饮和气泡常偏轻松舒展。
- 用户填写的实际颜色优先于材料推测。`

module.exports = {
  SONG_PROFILE_PROMPT_VERSION,
  COCKTAIL_PROFILE_PROMPT_VERSION,
  NAMING_PROMPT_VERSION,
  COCKTAIL_MATERIAL_GUIDE
}
