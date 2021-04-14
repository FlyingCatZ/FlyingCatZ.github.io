---
title: hexo将Blog转到Linux
date: 2021-04-15 00:49:49
tags: [hexo,博客]
categories: 博客
---

>   记录将blog从windows搬到linux

<!-- more -->

### 安装软件

```sh
sudo apt-get install -y git
sudo apt-get install -y nodejs
sudo apt-get install -y build-essential
sudo apt-get install -y npm
```

### 配置Git

```
jian@host:~$ ssh -T git@github.com
Hi FlyingCatZ! You've successfully authenticated, but GitHub does not provide shell access.
```

&emsp;&emsp;如果当前github上没有当前linux系统的ssh秘匙就需要生成并添加

```
ssh-keygen -t rsa -C "邮箱地址"
```

&emsp;&emsp;接着敲３次回车，完成之后在/home/xxx/.ssh/下面可以看到秘钥，将其添加到github上即可

### 拷贝源文件

&emsp;&emsp;核心文件是这些文件和文件夹

```
_config.yml
package.json
node_modules
scaffolds
source
themes
```

### 安装hexo和相关模块

```
sudo npm install hexo-cli -g
```

&emsp;&emsp;遇到错误，使用`--force`参数强制写入覆盖

```
npm install
npm install hexo-deployer-git --save  // 文章部署到 git 的模块
（下面为选择安装）
npm install hexo-generator-feed --save  // 建立 RSS 订阅
npm install hexo-generator-sitemap --save // 建立站点地图
```

&emsp;&emsp;大功告成

![Screenshot from 2021-04-15 01-20-27](https://res.cloudinary.com/flyingcatz/image/upload/v1618421362/samples/hexo/Screenshot_from_2021-04-15_01-20-27_wkmpgq.png)

参考：https://smelond.com/2018/06/21/hexo%E4%BB%8Ewindows%E6%90%AC%E5%AE%B6%E5%88%B0deepin/



