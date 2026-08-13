const test = require('node:test')
const assert = require('node:assert/strict')

const {
  cleanNeteaseLyrics,
  fetchNeteaseLyrics,
  fetchLikedPlaylistSongs
} = require('../cloudrun/music-assistant/netease-web')

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('NetEase lyrics remove timestamps and explicit production credits before analysis', () => {
  const source = [
    '[00:00.00] 作词 : 某人',
    '[00:01.00]作曲：某人',
    '[00:02.00][by:网易云音乐]',
    '[00:10.24]凌晨的街道还亮着灯',
    '[00:15.50]我把作词写进了故事里',
    '[00:20.00]混音：某人',
    '[00:25.10]继续向前走'
  ].join('\n')

  assert.equal(cleanNeteaseLyrics(source), [
    '凌晨的街道还亮着灯',
    '我把作词写进了故事里',
    '继续向前走'
  ].join('\n'))
})

test('lyrics are fetched with the original numeric song id and returned cleaned', async () => {
  const requests = []
  const lyrics = await fetchNeteaseLyrics('2049913337', async (url, options) => {
    requests.push({ url, options })
    return response({ code: 200, lrc: { lyric: '[00:01.00]作词：甲\n[00:05.00]夜色落下来' } })
  })

  assert.equal(lyrics, '夜色落下来')
  assert.match(requests[0].url, /id=2049913337/)
  assert.equal(Boolean(requests[0].options.signal), true)
})

test('liked playlist loading crosses the 30-song boundary and preserves playlist order', async () => {
  const ids = Array.from({ length: 45 }, (_, index) => 1000 + index)
  const requests = []
  const songs = await fetchLikedPlaylistSongs('5159253725', 31, async (url) => {
    requests.push(url)
    if (url.includes('/playlist/detail')) {
      return response({ code: 200, playlist: { trackIds: ids.map((id) => ({ id })) } })
    }
    const requestedIds = JSON.parse(new URL(url).searchParams.get('ids'))
    return response({
      code: 200,
      songs: [...requestedIds].reverse().map((id) => ({
        id,
        name: `歌曲${id}`,
        artists: [{ name: '歌手' }],
        album: { name: '专辑' }
      }))
    })
  })

  assert.equal(songs.length, 31)
  assert.deepEqual(songs.map((song) => song.id), ids.slice(0, 31).map(String))
  assert.equal(requests.filter((url) => url.includes('/song/detail')).length, 1)
})

test('liked playlist details are fetched in bounded batches up to the requested count', async () => {
  const ids = Array.from({ length: 260 }, (_, index) => 2000 + index)
  const batchSizes = []
  const songs = await fetchLikedPlaylistSongs('5159253725', 205, async (url) => {
    if (url.includes('/playlist/detail')) {
      return response({ code: 200, playlist: { trackIds: ids.map((id) => ({ id })) } })
    }
    const requestedIds = JSON.parse(new URL(url).searchParams.get('ids'))
    batchSizes.push(requestedIds.length)
    return response({
      code: 200,
      songs: requestedIds.map((id) => ({ id, name: `歌曲${id}`, artists: [], album: {} }))
    })
  })

  assert.equal(songs.length, 205)
  assert.deepEqual(batchSizes, [100, 100, 5])
})
