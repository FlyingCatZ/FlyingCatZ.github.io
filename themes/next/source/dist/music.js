const ap = new APlayer({
    container: document.getElementById('aplayer'),
    autoplay: false, //自动播放
	theme: "rgba(221,221,221,0.3)",
    loop: 'all', //循环播放, 'all'全部循环, 'one'单曲循环, 'none'不循环
	listFolded: true,//列表默认折叠
    listMaxHeight: 90,//列表最大高度
    audio: [
      {
       name: '第三人称',
       artist: ' ',
       url: 'https://od.lk/s/MzNfMTYzMjk2NTJf/%E7%AC%AC%E4%B8%89%E4%BA%BA%E7%A7%B0.mp3',
       cover: 'cover.jpg'
     },

       {
        name: '往后余生--王贰浪',
        artist: '马良',
        url: 'https://web.opendrive.com/api/v1/download/file.json/MzNfMTUzODMwMDBf?inline=1',
        cover: 'cover.jpg'
      },

      {
          name: '起风了',
          artist: '买辣椒也用券',
          url: 'https://od.lk/d/MzNfMTUzODMwMDFf/%E8%B5%B7%E9%A3%8E%E4%BA%86--%E4%B9%B0%E8%BE%A3%E6%A4%92%E4%B9%9F%E7%94%A8%E5%88%B8.mp3',
          cover: 'cover.jpg'
      }

			]
});
