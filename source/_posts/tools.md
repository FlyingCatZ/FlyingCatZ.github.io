---
title: vim & terminator使用
date: 2021-02-13 16:13:22
categories: [tools]
tags: [vim,terminator]
---



### 前言

​		使用SourceInsight查看源代码虽然很方便，但有时也会遇到无法跳转的情况，而且修改之后还要将文件上传到linux端才能进行编译，很不方便，于是乎全面转向vim的使用

<!-- more -->

### 一、配置

#### 1.1 vim

​		使用`vim --version`查看vim版本，我的是8.2版本，为了兼容一些插件的使用，配置文件为~/.vimrc，我的文件链接[vimrc](https://github.com/FlyingCatZ/tools/tree/main/vim)，vim因为增加了插件才会如此强大，而插件也是用vim的一些语法写的，究其原因还是因为设计的灵活，使其能够扩展

​		我使用的插件都在文件中有说明，我是用[vim-plug](https://github.com/junegunn/vim-plug)管理插件，主要是为了能够使用`asyncrun`和`YouCompleteMe`，所有插件如下

| 插件            | 作用                                     |
| --------------- | ---------------------------------------- |
| autoload_cscope | 自动加载cscope相关文件                   |
| NERD_tree       | 文件列表，F3开关                         |
| taglist         | 符号列表，F2开关                         |
| asyncrun        | 在vim中异步操作，F7编译，F10开关状态窗口 |
| YouCompleteMe   | 自动补全                                 |

​		前三个直接将文件放到.vim/plugin/目录中即可，后两个需要用vim-plug下载，文件全部在我的[Github](https://github.com/FlyingCatZ/tools)



#### 1.2 terminator

​		terminator的分屏特别好用，目前是我使用的主要终端工具，配置文件[config](https://github.com/FlyingCatZ/tools/tree/main/terminator)，将其放到~/.config/terminator/中即可



### 二、效果

#### 2.1 vim

![vim](https://res.cloudinary.com/flyingcatz/image/upload/v1613207569/vim%E5%B1%95%E7%A4%BA_ai9qy4.png "效果图")



#### 2.2 terminator

![terminator](https://res.cloudinary.com/flyingcatz/image/upload/v1613208483/terminator%E5%B1%95%E7%A4%BA_r81awe.png "效果图")































