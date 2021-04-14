---
title: hexo+Github搭建个人博客网站
date: 2019-04-16 19:23:22
categories: [博客]
tags: [hexo,Github,博客]
---
### 搭建自己的博客网站

<!-- more -->

>准备阶段

​		首先，需要准备一个Github账号，直接注册即可。

​		安装好node.js 和 npm（只需到官网下载安装包即可，不同平台安装方法不一样），npm 会捆绑nodejs一起安装，具体看手册。

​		如果需要重定向域名，还需要去买一个域名，腾讯云阿里云都行，不需要可以不买，准备阶段就这些

>Github创建博客站点仓库，用于存储网页相关文件

​		进入Github个人仓库，新建一个repo，注：不能随意命名，仓库名必须是  `Github账号的名字.github.io`，因为这是GitHub的一个开源项目，这样命名就是说明这个仓库用于保存你的网站文件（详情请自行参考GitHub），其他可不填

>新建文件夹，安装hexo

​		新建一个文件夹并进入文件夹，用于本地网站文件存储，这里安装[hexo](https://hexo.io/docs/index.html)（开源博客框架）依赖上面安装的npm和node.js，右键打开power shell 或 Git Bash 或 cmd，`npm install -g hexo-cli
`,等待安装成功，接着`hexo init`,`npm install`，一个博客网站就完成了（这里可能就是框架的作用，一个命令就搞定所有所需文件）

>配置文件

​		打开文件根目录下的 _config.yml 文件，修改网站的信息，在power shell 或 Git Bash 或 cmd 中输入 `hexo g` 生成网站文件，`hexo s` 启动本地服务器可以在不联网的情况下查看网站。/themes/xxx这里的文件是主题相关的，修改之后需要将之前生成的网站文件清除掉，执行`hexo clean`，改完之后`hexo g`，一般主题都在GitHub上有说明怎么使用，具体配置参考其他博客，参考[主題](https://hexo.io/zh-tw/docs/themes.html)

>部署网站

​		网站文件生成之后需要将网站文件传到GitHub那个刚刚建好的仓库之中，需要将本地的网站文件与Github仓库关联起来，需要将网站配置文件 _config.yml 中的deploy，修改为：
```
deploy:
  type: git
  repo: git@github.com:GitHub账户名字/GitHub账户名字.github.io.git
  branch: master
```
​		注：这里repo的链接决定上传到GitHub的方式，ssh方式更快且不需要每次都输入ID和密码，然后在主目录中输入 `npm install hexo-deployer-git --save` ，重新执行 `hexo clean` ， `hexo g` ，然后执行 `hexo d`部署网站文件，hexo会自动将网文件上传到GitHub中，然后访问`GitHub账户名字.github.io.git`这个站点就能访问自己的网站

>更改域名

​		域名更改需要在/source/目录下新建一个名为 CNAME 的文件（是CNAME不是GNAME），输入你的域名（最好不带www.，这样无论带不带www.博客都能访问），并将域名解析与你的GitHub库关联起来（域名解析需要到一些平台，本人使用的[腾讯云](https://cloud.tencent.com/document/product/302/3446)，这里不过多赘述），保存即可

>写博客

​		主目录执行`hexo n "博客名字"`，新建了一篇博客，在`顶层目录/source/_posts/`目录下就会生成你的博客文件，之后才真正进行你的创作，一个好用的Markdown编辑器（我用的是Typora）可以提升体验（Markdowm语法请自行Google），博客书写遵循Markdown语法，是一种很高效的东东，可以学习一下，写完重新生成，部署，大功告成

>后续可以自定义主题样式以及一些功能


​		笔者博客：[My Blog](https://www.jian1024.cn/)
