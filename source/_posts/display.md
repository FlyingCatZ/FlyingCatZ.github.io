---
title: display subsystem
date: 2021-03-05 00:52:36
tags: [显示驱动,display,LCD,驱动]
categories: Linux
---

#### 前言

&emsp;&emsp;分析AM57xx系列架构显示原理，分别从硬件和软件两方面入手。总体看来，AM57xx系列芯片在硬件上面将显示部分分成了几大子系统，每个子系统负责相应的部分，而显示最基础的子系统就是DSS（Display Subsystem），它负责将frame buffer中图像数据真正的显示在显示器上。目前需求仅为显示静态图像，所以只分析这个子系统。

<!-- more -->

#### 一. 显示基础

&emsp;&emsp;显示最基础的部件就是显示器/显示屏，而显示器由显示面板（display panel）和显示驱动器（display driver）组成，display panel负责发光，这也就是显示器的显示原理，根据其显示原理的不同，可以分为CRT、LED、OLED、LCD等显示器，其中CRT为阴极射线管发光显示，主要应用为上世纪的电视机显示，LED利用发光二极管显示，主要应用在广场中广告屏的显示，OLED为有机发光二极管，是目前娱乐设备的主要显示载体，主要用于超薄柔性显示，而LCD是液晶显示，目前主流的显示器，应用在各行各业。而display driver一是负责接收显示数据，二是控制控制面板发光。

&emsp;&emsp;连接显示器的接口叫display interface，目前主流的display interface有VGA、DVI、HDMI、DP、雷电等接口，首先是VGA接口，CPU使用的是TTL电平，通过VGA接口则直接连接，因为其传输的是模拟信号。DVI传输的是数字信号，高分辨率下更加清晰并且失真会更少。HDMI接口（High Definition Multimedia Interface）是一种全数字化影像和声音传送接口，可以传送未压缩的音讯及视频信号，目前最流行的接口。DP接口（Display Port）具有上面所有显示器接口的一切优点，但目前成本较高。雷电接口融合了PCI Express和DisplayPort接口两种通信协议，PCI Express用于数据传输，DisplayPort用于显示，能同步传输1080p乃至4K视频和最多八声道音频，最高可达到40Gbps。

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614877431/samples/display/image-20200929164811165_skvhtc.png" alt="image-20200929164811165" style="zoom:67%;" />

![image-20201008190149500](https://res.cloudinary.com/flyingcatz/image/upload/v1614877431/samples/display/image-20201008190149500_xmw3h4.png)

&emsp;&emsp;MIPI （Mobile Industry Processor Interface） 是2003年由ARM， Nokia， ST ，TI等公司成立的一个联盟，目的是把手机内部的接口如摄像头、显示屏接口、射频/基带接口等标准化，从而减少手机设计的复杂程度和增加设计灵活性。MIPI信号是成对传输的，主要是为了减少干扰，MIPI信号成对走线，两根线从波形看是成反相，所以有外部干扰过来，就会被抵消很大部分。主要用在平板和手机上使用。

&emsp;&emsp;MIPI接口LCD包括1对差分时钟（CLKP，CLKN），4对数据差分线（D0P，D0N；D1P，D1N；D2P，D2N；D3P，D3N），每一对之间有GND线，4对数据差分线并不一定要全部使用，很多屏只需要2对就可以了；RESET（复位脚），STBYB（高电平有效），VGL，VGH（像素点上开关管的开启关闭电压，加在开关管的栅极上，VGH 高电平打开给像素点电容充电， VGL 负电压 关闭开关管），VCOM（ 液晶像素点的存储电容共用电极），VLED-（背光负极），VLED+（背光正极），电源有1.8V和3.3V。

&emsp;&emsp;MIPI的液晶数据传输中涉及到是DWG（Display Working Group）工作组，该工作组提出了4种液晶规范分别为DCS（Display Command Set）、DBI（Display Bus Interface）、DPI（Display Pixel Interface）、DSI（Display Serial Interface）。DPI接口也可称为RGB接口，DBI接口可称为MCU接口

1. **MIPI DCS（Display Command Set）**

   &emsp;&emsp;规范中规定了显示命令设置的一些规范，它并没有说明它具体的硬件连接方式，规定了液晶传输中各个命令的值和意义以及命令说明，主要是为了配合DBI规范、DSI规范来使用的。

2. **MIPI DBI（Display Bus Interface）**

   &emsp;&emsp;规范中规定了它的硬件接口方式，它是液晶数据总线接口，可细分为MIPI DBI Type A、MIPI DBI TypeB、MIPI DBI Type C这三种不同的模式，不同模式下的硬件接口以及数据的采样都有所不同，如在MIPI DBI Type A规范中规定是下降沿采样数据值（摩托罗拉6800接口 ），MIPI DBI Type B规范中规定是上升沿采样数据（英特尔8080接口 ）。
   &emsp;&emsp;MIPI DBI Type A和MIPI DBI Type B同时又可细分为5种不同数据接口模式，分别为8位数据接口、9位数据接口、16位数据接口、18位数据接口、24位数据接口。不过市面上支持9位数据接口的液晶驱动IC并不多见，当然数据接口越大那么相同一个周期内数据接口越大，所传输的数据越多。而MIPI DBI Type C 只适用于传输于DCS规范中规定的命令和该命令所需要的参数值，不能传输液晶像素的颜色值（虽然DBI规范中规定能传输颜色值，不过市面上的液晶驱动IC是用来传输命令和命令所需的参数值）。
   &emsp;&emsp;同样在DBI（Display Bus Interface）规范中规定不同数据接口所支持颜色位数。具体还是要参考所使用的液晶驱动IC资料来确定。
   &emsp;&emsp;谈到颜色位数，需要说一下何谓颜色位数，颜色位数也称色彩位数，位图或者视频帧缓冲区中储存1像素的颜色所用的位数,它也称为位/像素(bpp)。色彩深度越高,可用的颜色就越多。市面常用液晶驱动IC支持的颜色位数有16、18、24这三种。

3. **MIPI DPI（Display Pixel Interface）**

   &emsp;&emsp;规范中所规定的硬件接口跟DBI规范中并不相同，它不是像DBI规范用Command/Data配置液晶驱动IC的寄存器再进行操作。某种程度上，DPI与DBI的最大差别是DPI的数据线和控制线分离，而DBI是复用的。同样使用DBI接口的液晶很少有大屏幕的，因为需要更多的GRAM从而提高了生产成本，而DPI接口即不需要，因为它是直接写屏，速度快，常用于显示视频或动画用。
   &emsp;&emsp;DPI从它的名称中就可以看出它是直接对液晶的各像素点进行操作的，它是利用（H，V）这两个行场信号进行对各像素点进行颜色填充操作。填充速度快，可用于动画显示，目前手机液晶屏所用的接口就是这一类。H（H-SYNC）称为行同步信号；V（V-SYNC）称为场同步信号。它像模拟电视机那样用电子枪那样进行扫频显示，不过它对时序控制要求很高。因此一般的MCU芯片很难支持。

4. **MIPI DSI(Display Serial Interface)**

   符合MIPI协定的串列显示器界面协议，主机与显示器之间用差分信号线连接。
   一对clock信号和1~4对data信号
   一般情况下data0可以配置成双向传输
   一个主机端可以允许同时与多个从属端进行通信

&emsp;&emsp;最后就是display controller，也就是显示控制器，显示控制器如果在系统中配置使用了，则与其他设备一样挂载到总线上，最后，三者关系如下

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614877433/samples/display/display_feyrnx.png" alt="display" style="zoom:30%;" />



#### 二. AM57xx DSS

&emsp;&emsp;AM57xx系列芯片都有一个显示子系统DSS（Display Subsystem），总体架构为

![image-20201019110632743](https://res.cloudinary.com/flyingcatz/image/upload/v1614877431/samples/display/image-20201019110632743_unug6k.png)

&emsp;&emsp;DSS主要由DISPC（Display controller）和HDMI protocol engine组成，DISPC又由DMA、LCD/TV outputs、GFX（graphics pipeline）、video pipelines、write-back pipeline组成。

##### 2.1 DISPC

&emsp;&emsp;在显示过程中必须得去配置DISPC使其工作起来，五个管道（pipelines）中，VIDx和GFX负责图像数据的输出，WB负责数据的反馈以进行图像数据的处理，三个LCD outputs则负责将输入的ARGB32-8888格式像素数据转换成 RGB24-888 或 YUV4:2:2 格式像素数据，TV out负责将ARGB40-10.10.10.10格式像素数据直接输出，支持MIPI DPI协议。

​		数据的源头都是通过DMA搬运，节省CPU的开销。架构为：

![image-20201019171629011](https://res.cloudinary.com/flyingcatz/image/upload/v1614877431/samples/display/image-20201019171629011_sgf49x.png)

##### 2.2 HDMI

&emsp;&emsp;HDMI总体架构：

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614877432/samples/display/image-20201019172746174_psdzlx.png" alt="image-20201019172746174" style="zoom:100%;" />

&emsp;&emsp;当DISPC处理好数据格式，将数据发送给HDMI模块，而HDMI模块再将数据传送给HDMI_PHY，HDMI_PHY负责将数据输出显示，当配置HDMI接口时需要配置HDCP、HDMI模块、HDMI_PHY、PLLTRL_HDMI四个模块才能使其工作。工作时也需遵循HDMI接口标准。



#### 三. 显示子系统

##### 3.1 总览

&emsp;&emsp;显示子系统是Linux系统中最复杂的子系统之一，因为其操作的复杂性，GPU工作的特殊性和重要性，导致整个显示子系统的层次关系很多，我们只关注kernel部分。

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614877432/samples/display/seq_dispaly_gzylbc.png" alt="seq_dispaly" style="zoom:18%;" />

&emsp;&emsp;在Linux内核中对于显示部分的驱动被分成了两部分，一部分是gpu目录下的显卡的驱动，另一部分是video目录下视频相关的驱动，二者都是基于frame buffer（帧缓存），在gpu/目录中，最外层的各种drm_xxx文件实现了DRI（Direct Render Infrastructure），通过这些接口能够直接访问底层的图形设备，例如LCDC、GPU等，而具体的硬件驱动在更具体的下一级目录中。通过Makefile文件可以梳理出DRM架构各个文件之间的关系：

```makefile
drm-y       :=	drm_auth.o drm_bufs.o drm_cache.o \
		drm_context.o drm_dma.o \
		drm_fops.o drm_gem.o drm_ioctl.o drm_irq.o \
		drm_lock.o drm_memory.o drm_drv.o drm_vm.o \
		drm_scatter.o drm_pci.o \
		drm_platform.o drm_sysfs.o drm_hashtab.o drm_mm.o \
		drm_crtc.o drm_modes.o drm_edid.o \
		drm_info.o drm_debugfs.o drm_encoder_slave.o \
		drm_trace_points.o drm_global.o drm_prime.o \
		drm_rect.o drm_vma_manager.o drm_flip_work.o \
		drm_modeset_lock.o drm_atomic.o drm_bridge.o

drm-$(CONFIG_DRM_GEM_CMA_HELPER) += drm_gem_cma_helper.o
drm-$(CONFIG_PCI) += ati_pcigart.o
drm-$(CONFIG_OF) += drm_of.o

drm-y += $(drm-m)
```

&emsp;&emsp;内核中的DRM为X server或Mesa 实现了操作操作硬件的接口，从而保证图像数据传输的低延迟。在同一文件夹下还存在着另外一种架构，这种架构主要是将用于控制显示设备属性的操作提供给上层直接使用，KMS（Kernel Mode Set）就是为了实现这种操作。在gpu/drm/目录中，实现KMS的文件有：

```makefile
drm_kms_helper-y := drm_crtc_helper.o drm_dp_helper.o drm_probe_helper.o \
		drm_plane_helper.o drm_dp_mst_topology.o drm_atomic_helper.o
drm_kms_helper-$(CONFIG_DRM_FBDEV_EMULATION) += drm_fb_helper.o
drm_kms_helper-$(CONFIG_DRM_KMS_CMA_HELPER) += drm_fb_cma_helper.o

obj-$(CONFIG_DRM_KMS_HELPER) += drm_kms_helper.o
```

&emsp;&emsp;通过DRM和KMS的封装，他们向上提供接口，向下协调硬件驱动。下面分析AM57xx系列芯片的显示驱动，同样是Makefile文件：

```makefile
    obj-y			+= omapdrm/
    obj-y			+= tilcdc/
    obj-y			+= i2c/
    obj-y			+= panel/
    obj-y			+= bridge/
```

&emsp;&emsp;其中，omapdrm/目录中实现AM57xx系列芯片上面对应的显示子系统，tilcdc/目录则是LCD controller下面抽象层次的实现，i2c/、panel/、bridge/目录则是关系具体的显示驱动底层的代码，默认的是NXP_TDA998X，后续需要根据具体显示设备具体分析，各个目录中的显示驱动程序所需要调用通用函数则都是在当前目录中实现，在当前目录还实现了DRM的核心层。

##### 3.2 DRM

&emsp;&emsp;DRM（Direct Render Manager）站在所有图形驱动的上层，为图形驱动程序提供了多种服务，同时向上通过libdrm提供应用程序接口，libdrm是包装大多数DRM ioctl的库。DRM提供的服务包括vblank事件处理，内存管理，输出管理，帧缓冲区管理，命令提交和防护，挂起/恢复支持以及DMA传输。

&emsp;&emsp;其驱动代码在gpu/omapdrm/omap_drv.c中，主要结构是drm_driver

```C
static struct drm_driver omap_drm_driver = {
	.driver_features = DRIVER_MODESET | DRIVER_GEM  | DRIVER_PRIME |
		DRIVER_ATOMIC | DRIVER_RENDER,
	.load = dev_load,
	.unload = dev_unload,
	.open = dev_open,
	.lastclose = dev_lastclose,
	.preclose = dev_preclose,
	.postclose = dev_postclose,
	.set_busid = drm_platform_set_busid,
	.get_vblank_counter = drm_vblank_no_hw_counter,
	.enable_vblank = omap_irq_enable_vblank,
	.disable_vblank = omap_irq_disable_vblank,
#ifdef CONFIG_DEBUG_FS
	.debugfs_init = omap_debugfs_init,
	.debugfs_cleanup = omap_debugfs_cleanup,
#endif
	.prime_handle_to_fd = drm_gem_prime_handle_to_fd,
	.prime_fd_to_handle = drm_gem_prime_fd_to_handle,
	.gem_prime_export = omap_gem_prime_export,
	.gem_prime_import = omap_gem_prime_import,
	.gem_free_object = omap_gem_free_object,
	.gem_vm_ops = &omap_gem_vm_ops,
	.dumb_create = omap_gem_dumb_create,
	.dumb_map_offset = omap_gem_dumb_map_offset,
	.dumb_destroy = drm_gem_dumb_destroy,
	.ioctls = ioctls,
	.num_ioctls = DRM_OMAP_NUM_IOCTLS,
	.fops = &omapdriver_fops,
	.name = DRIVER_NAME,
	.desc = DRIVER_DESC,
	.date = DRIVER_DATE,
	.major = DRIVER_MAJOR,
	.minor = DRIVER_MINOR,
	.patchlevel = DRIVER_PATCHLEVEL,
};
```

&emsp;&emsp;在Linux系统中需要大量的图形内存来存储与图形有关的数据，因此内存管理在DRM中至关重要，而且在DRM基础架构中发挥着核心作用。在DRM的内存管理核心子模块中包含两个内存管理器，Translation Table Manager（TTM）和Graphics Execution Manager（GEM）。

&emsp;&emsp;TTM提供一个单一的用户空间API，可以满足所用硬件的要求，同时支持统一内存体系结构（UMA）设备和具有专用视频RAM的设备，同时也导致代码庞大而复杂。GEM为应对TTM的复杂性，没有为每个与图形内存相关的问题提供解决方案，而是确定驱动程序之间的通用代码，并创建一个共享的支持库，从而使初始化和执行要求更简单，但是不具有RAM管理功能，也仅限于UMA设备。

&emsp;&emsp;vma-manager负责将依赖于驱动程序的任意内存区域映射到线性用户地址空间。

&emsp;&emsp;PRIME是drm中的跨设备缓冲区共享框架，对于用户空间，PRIME缓冲区是基于dma-buf的文件描述符。

&emsp;&emsp;drm_mm提供了一个简单的范围分配器。如果驱动程序合适的话，可以自由使用Linux内核中的资源分配器，drm_mm的好处是它位于DRM内核中，这意味着可以更容易满足gpu的一些特殊用途需求。

##### 3.3 KMS

&emsp;&emsp;KMS通过frame buffer提供给用户空间，而frame buffer结构嵌入到plane（面）结构中构成KMS的基本对象，面结构用drm_plane表示，之后plane再将像素数据传入crtc。crtc代表整个显示管道，从drm_plane接收像素数据，并将数据混合到一起，之后crtc将数据输出到多个编码器，用drm_encoder表示，当crtc在运行时则至少有一个drm_encoder，每个编码器再将数据输出到连接器，drm_connector，连接器与编码器的连接可以通过软件指定。一个编码器可以驱动多个连接器，但一个连接器只能有一个编码器。

![image-20201026195531904](https://res.cloudinary.com/flyingcatz/image/upload/v1614877431/samples/display/image-20201026195531904_cuif1i.png)

&emsp;&emsp;为了能够共享编码器的代码，可以将一个或多个Framebuffer GEM Helper Reference（由struct drm_bridge表示）链接到编码器。该链接是静态的，无法更改，这意味着需要在CRTC和任何编码器之间打开交叉映射开关。另一个对象是面板（drm_panel），它的存在是为了以某种形式显示像素的其他东西，通常嵌入到连接器中。

![image-20201027092623444](https://res.cloudinary.com/flyingcatz/image/upload/v1614877432/samples/display/image-20201027092623444_jbr83g.png)

&emsp;&emsp;最后，通过连接器抽象实际的接收器，暴露给用户空间，通过这些KMS对象来完成数据的转换和输出。

##### 3.4 dss

&emsp;&emsp;在drm/的顶层目录下的很多文件就是为了实现DRM和KMS架构，根据Makefile文件得知，DRM架构也需要i2c/、panel/、bridge/等核心模块支撑，其中panel/实现DRM面板驱动程序，最多需要一个调节器和一个GPIO才能运行，i2c/中的驱动是为了那些需要I2C协议的编码器，bridge/中的代码则是为了特殊display架构的需要。

&emsp;&emsp;最后，剩下的便是各大厂家的驱动，以TI为例，TI实现了两种显示驱动的框架，一种是以LCDC作为显示控制器的显示架构，分布在tilcdc/中。另一种则是以gpu作为显示控制器的显示架构，分布在omapdrm/中。

&emsp;&emsp;AM57xx平台采用gpu作为显示控制器，所以其代码在omapdrm/中，在omapdrm/顶层目录的代码实现DRM架构所需要的内存管理、中断、帧缓存等核心操作，同时在这个层次实现KMS架构中子模块的驱动，包括plane、crtc、encoder、connector。从drm_driver结构中可以看到omap_drm_driver所确定的操作，omap_drm_driver的操作会向下调用具体的函数，这些都以函数指针的形式调用。

&emsp;&emsp;init函数中去注册platform_drivers结

```C
static struct platform_driver * const drivers[] = {
	&omap_dmm_driver,
	&pdev,
};

struct platform_driver omap_dmm_driver = {
	.probe = omap_dmm_probe,
	.remove = omap_dmm_remove,
	.driver = {
		.owner = THIS_MODULE,
		.name = DMM_DRIVER_NAME,
		.of_match_table = of_match_ptr(dmm_of_match),
		.pm = &omap_dmm_pm_ops,
	},
};

static struct platform_driver pdev = {
	.driver = {
		.name = DRIVER_NAME,
		.pm = &omapdrm_pm_ops,
	},
	.probe = pdev_probe,
	.remove = pdev_remove,
};

static const struct of_device_id dmm_of_match[] = {
	{
		.compatible = "ti,omap4-dmm",
		.data = &dmm_omap4_platform_data,
	},
	{
		.compatible = "ti,omap5-dmm",
		.data = &dmm_omap5_platform_data,
	},
	{
		.compatible = "ti,dra7-dmm",
		.data = &dmm_dra7_platform_data,
	},
	{},
};
```

&emsp;&emsp;dss在设备树中的节点：

```C
dss@58000000 {
			compatible = "ti,dra7-dss";
			status = "ok";
			ti,hwmods = "dss_core";
			syscon-pll-ctrl = <0x8 0x538>;
			#address-cells = <0x1>;
			#size-cells = <0x1>;
			ranges;
			reg = <0x58000000 0x80 0x58004054 0x4 0x58004300 0x20 0x58009054 0x4 0x58009300 0x20>;
			reg-names = "dss", "pll1_clkctrl", "pll1", "pll2_clkctrl", "pll2";
			clocks = <0x10f 0x110 0x111>;
			clock-names = "fck", "video1_clk", "video2_clk";
			vdda_video-supply = <0x112>;

			dispc@58001000 {
				compatible = "ti,dra7-dispc";
				reg = <0x58001000 0x1000>;
				interrupts = <0x0 0x14 0x4>;
				ti,hwmods = "dss_dispc";
				clocks = <0x10f>;
				clock-names = "fck";
				syscon-pol = <0x8 0x534>;
			};

			encoder@58060000 {
				compatible = "ti,dra7-hdmi";
				reg = <0x58040000 0x200 0x58040200 0x80 0x58040300 0x80 0x58060000 0x19000>;
				reg-names = "wp", "pll", "phy", "core";
				interrupts = <0x0 0x60 0x4>;
				status = "disabled";
				ti,hwmods = "dss_hdmi";
				clocks = <0x113 0x114>;
				clock-names = "fck", "sys_clk";
				dmas = <0xd3 0x4c>;
				dma-names = "audio_tx";
			};
		};
```

&emsp;&emsp;dss/目录中实现了TI DSS显示子系统的驱动，包括其中的dispc、hdmi engine以及支持的接口，在omap2系列平台中支持dpi接口、dsi接口、rfbi接口、venc接口、sdi接口，omap4以及以上平台支持hdmi接口，它们的驱动分别在具体的文件中，根据CONFIG_OMAPx_DSS_xxx来决定使用哪个接口。AM57xx平台当前配置为DPI接口和hdmi接口。

&emsp;&emsp;DSS部分的代码可以分成四部分，omapdss_boot_init、omapdss_base、omapdss、omapdss6

* omapdss_boot_init

  这部分代码主要进行初始化，根据从设备树上匹配的dss节点进行配置数据，主要是通过“ti,dra7-dss”属性找到dss节点，再遍历其中的子节点

  ```C
  static const struct of_device_id omapdss_of_match[] __initconst = {
  	{ .compatible = "ti,omap2-dss", },
  	{ .compatible = "ti,omap3-dss", },
  	{ .compatible = "ti,omap4-dss", },
  	{ .compatible = "ti,omap5-dss", },
  	{ .compatible = "ti,dra7-dss", },
  	{ .compatible = "ti,k2g-dss", },
  	{},
  };
  
  static int __init omapdss_boot_init(void)
  {
  	struct device_node *dss, *child;
  
  	INIT_LIST_HEAD(&dss_conv_list);
  
  	dss = of_find_matching_node(NULL, omapdss_of_match);
  
  	omapdss_walk_device(dss, true);
  
  	for_each_available_child_of_node(dss, child) {
  		if (!of_find_property(child, "compatible", NULL))
  			continue;
  		omapdss_walk_device(child, true);
  	}
  
  	while (!list_empty(&dss_conv_list)) {
  		struct dss_conv_node *n;
  
  		n = list_first_entry(&dss_conv_list, struct dss_conv_node, list);
  
  		if (!n->root)
  			omapdss_omapify_node(n->node);
  
  		list_del(&n->list);
  		of_node_put(n->node);
  		kfree(n);
  	}
  
  	return 0;
  }
  ```

* omapdss_base

  base部分代码由四部分组成，base、display、dss-of、output，每一部分都是实现DRM的基础，所以也是dss的基础，只列举其中的两个函数

  ```C
  static void omapdss_walk_device(struct device *dev, struct device_node *node,
  				bool dss_core)
  {
  	struct device_node *n;
  	struct omapdss_comp_node *comp = devm_kzalloc(dev, sizeof(*comp),
  						      GFP_KERNEL);
  	n = of_get_child_by_name(node, "ports");
  
  	of_node_put(n);
  
  	n = NULL;
  	while ((n = of_graph_get_next_endpoint(node, n)) != NULL) {
  		struct device_node *pn = of_graph_get_remote_port_parent(n);
  
  		if (!pn)
  			continue;
  
  		if (!of_device_is_available(pn) || omapdss_list_contains(pn)) {
  			of_node_put(pn);
  			continue;
  		}
  		omapdss_walk_device(dev, pn, false);
  	}
  }
  
  bool omapdss_stack_is_ready(void)
  {
  	struct omapdss_comp_node *comp;
  
  	list_for_each_entry(comp, &omapdss_comp_list, list) {
  		if (!omapdss_component_is_loaded(comp))
  			return false;
  	}
  
  	return true;
  }
  ```

* omapdss

  这部分是TI dss架构的核心驱动代码，为了能够支持更多的设备和方便管理，这里同样抽象出核心层来对具体的驱动进行管理，这部分主要是dispc驱动代码以及具体的接口的驱动

  ```C
  static const struct of_device_id dispc_of_match[] = {
  	{ .compatible = "ti,omap2-dispc", },
  	{ .compatible = "ti,omap3-dispc", },
  	{ .compatible = "ti,omap4-dispc", },
  	{ .compatible = "ti,omap5-dispc", },
  	{ .compatible = "ti,dra7-dispc", },
  	{},
  };
  
  static struct platform_driver omap_dispchw_driver = {
  	.probe		= dispc_probe,
  	.remove         = dispc_remove,
  	.driver         = {
  		.name   = "omapdss_dispc",
  		.pm	= &dispc_pm_ops,
  		.of_match_table = dispc_of_match,
  		.suppress_bind_attrs = true,
  	},
  };
  
  int __init dispc_init_platform_driver(void)
  {
  	return platform_driver_register(&omap_dispchw_driver);
  }
  
  void dispc_uninit_platform_driver(void)
  {
  	platform_driver_unregister(&omap_dispchw_driver);
  }
  ```

* omapdss6

  对比可以发现，omapdss6是TI为了对自己家新平台k2g的支持，原理和前面dss架构相同

```C
static struct platform_driver dss6_driver = {
	.probe		= dss6_probe,
	.remove		= dss6_remove,
	.driver         = {
		.name   = "omap_dss6",
		.pm	= &dss6_pm_ops,
		.of_match_table = dss6_of_match,
		.suppress_bind_attrs = true,
	},
};
```

##### 3.5 displays

&emsp;&emsp;display/目录下都是和具体硬件相关的驱动代码，由encoder、connector、panel三部分组成，根据配置CONFIG_DISPLAY_xxx_xx决定使用哪个具体的驱动，如果没有对应的型号可以自己编写对应的驱动

```makefile
obj-$(CONFIG_DISPLAY_ENCODER_OPA362) += encoder-opa362.o
obj-$(CONFIG_DISPLAY_ENCODER_TFP410) += encoder-tfp410.o
obj-$(CONFIG_DISPLAY_ENCODER_TPD12S015) += encoder-tpd12s015.o
obj-$(CONFIG_DISPLAY_DRA7EVM_ENCODER_TPD12S015) += dra7-evm-encoder-tpd12s015.o
obj-$(CONFIG_DISPLAY_ENCODER_SII9022) += encoder-sii9022.o
encoder-sii9022-y += encoder-sii9022-video.o
encoder-sii9022-$(CONFIG_DISPLAY_ENCODER_SII9022_AUDIO_CODEC) += encoder-sii9022-audio.o
obj-$(CONFIG_DISPLAY_ENCODER_TC358768) += encoder-tc358768.o
obj-$(CONFIG_DISPLAY_CONNECTOR_DVI) += connector-dvi.o
obj-$(CONFIG_DISPLAY_CONNECTOR_HDMI) += connector-hdmi.o
obj-$(CONFIG_DISPLAY_CONNECTOR_ANALOG_TV) += connector-analog-tv.o
obj-$(CONFIG_DISPLAY_PANEL_DPI) += panel-dpi.o
obj-$(CONFIG_DISPLAY_PANEL_DSI_CM) += panel-dsi-cm.o
obj-$(CONFIG_DISPLAY_PANEL_SONY_ACX565AKM) += panel-sony-acx565akm.o
obj-$(CONFIG_DISPLAY_PANEL_LGPHILIPS_LB035Q02) += panel-lgphilips-lb035q02.o
obj-$(CONFIG_DISPLAY_PANEL_SHARP_LS037V7DW01) += panel-sharp-ls037v7dw01.o
obj-$(CONFIG_DISPLAY_PANEL_TPO_TD028TTEC1) += panel-tpo-td028ttec1.o
obj-$(CONFIG_DISPLAY_PANEL_TPO_TD043MTEA1) += panel-tpo-td043mtea1.o
obj-$(CONFIG_DISPLAY_PANEL_NEC_NL8048HL11) += panel-nec-nl8048hl11.o
obj-$(CONFIG_DISPLAY_PANEL_TLC59108) += panel-tlc59108.o
```

&emsp;&emsp;displays部分代码包含三部分，encoder、connector、panel，encoder部分包含了三种编码器，tpd12s015、sii9022、tc358768，connector使用hdmi，panel使用dpi

encoder：

```C
static struct i2c_driver sii9022_driver = {
	.driver = {
		.name  = "sii9022",
		.owner = THIS_MODULE,
		.of_match_table = sii9022_of_match,
		},
	.probe		= sii9022_probe,
	.remove		= sii9022_remove,
	.id_table	= sii9022_id,
};

static struct platform_driver tpd_driver = {
	.probe	= tpd_probe,
	.remove	= __exit_p(tpd_remove),
	.driver	= {
		.name	= "tpd12s015",
		.of_match_table = tpd_of_match,
		.suppress_bind_attrs = true,
	},
};

static struct i2c_driver tc358768_i2c_driver = {
	.driver = {
		.owner		= THIS_MODULE,
		.name		= TC358768_NAME,
		.of_match_table	= tc358768_of_match,
	},
	.id_table	= tc358768_id,
	.probe		= tc358768_i2c_probe,
	.remove		= tc358768_i2c_remove,
};
```

&emsp;&emsp;connector & panel：

```C
static struct platform_driver hdmi_connector_driver = {
	.probe	= hdmic_probe,
	.remove	= __exit_p(hdmic_remove),
	.driver	= {
		.name	= "connector-hdmi",
		.of_match_table = hdmic_of_match,
		.suppress_bind_attrs = true,
	},
};

static struct platform_driver panel_dpi_driver = {
	.probe = panel_dpi_probe,
	.remove = __exit_p(panel_dpi_remove),
	.driver = {
		.name = "panel-dpi",
		.of_match_table = panel_dpi_of_match,
		.suppress_bind_attrs = true,
	},
};

static struct i2c_driver tlc59108_i2c_driver = {
	.driver = {
		.owner	= THIS_MODULE,
		.name	= TLC_NAME,
		.of_match_table = tlc59108_of_match,
	},
	.id_table	= tlc59108_id,
	.probe		= tlc59108_i2c_probe,
	.remove		= tlc59108_i2c_remove,
};
```

&emsp;&emsp;最终，pixel数据通过connector和panel转换成屏幕设备可以识别的格式，再通过自身的解码器将图像数据显示在屏幕上。



#### 四. 驱动分析

##### omap_drm_driver

&emsp;&emsp;下面具体分析gpu/目录下整个TI SOC显示架构驱动，在最顶层是drm/、vga/、host1x/、ipu-v3/四个目录，其中drm/和vga/是无条件必须支持的模块，但vga模块这里没有使用到，因为我们使用的是MIPI DPI接口以及HDMI接口，DRM则是支撑整个显示子系统的核心，ipu模块则需要根据硬件平台是否启用， host1x模块是DMA引擎，用于对Tegra的图形和多媒体相关模块进行寄存器访问。所以重点在drm/目录。

&emsp;&emsp;在drm/的顶层目录下的很多文件就是为了实现DRM和KMS架构，根据Makefile文件得知，DRM架构也需要i2c/、panel/、bridge/等核心模块支撑，其中panel/实现DRM面板驱动程序，最多需要一个调节器和一个GPIO才能运行，i2c/中的驱动是为了那些需要I2C协议的编码器，bridge/中的代码则是为了特殊display架构的需要。

&emsp;&emsp;最后，剩下的便是各大厂家的驱动，以TI为例，TI实现了两种显示驱动的框架，一种是以LCDC作为显示控制器的显示架构，分布在tilcdc/中。另一种则是以gpu作为显示控制器的显示架构，分布在omapdrm/中。

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614877432/samples/display/ti_display_cy7yuz.png" alt="ti_display" style="zoom:30%;" />

&emsp;&emsp;AM57xx平台采用gpu作为显示控制器，所以其代码在omapdrm/中，在omapdrm/顶层目录的代码实现DRM架构所需要的内存管理、中断、帧缓存等核心操作，同时在这个层次实现KMS架构中子模块的驱动，包括plane、crtc、encoder、connector。从drm_driver结构中可以看到omap_drm_driver所确定的操作，omap_drm_driver的操作会向下调用具体的函数，这些都以函数指针的形式调用。

&emsp;&emsp;init函数中去注册platform_drivers结构

```C
static struct platform_driver * const drivers[] = {
	&omap_dmm_driver,
	&pdev,
};

struct platform_driver omap_dmm_driver = {
	.probe = omap_dmm_probe,
	.remove = omap_dmm_remove,
	.driver = {
		.owner = THIS_MODULE,
		.name = DMM_DRIVER_NAME,
		.of_match_table = of_match_ptr(dmm_of_match),
		.pm = &omap_dmm_pm_ops,
	},
};

static struct platform_driver pdev = {
	.driver = {
		.name = DRIVER_NAME,
		.pm = &omapdrm_pm_ops,
	},
	.probe = pdev_probe,
	.remove = pdev_remove,
};

static const struct of_device_id dmm_of_match[] = {
	{
		.compatible = "ti,omap4-dmm",
		.data = &dmm_omap4_platform_data,
	},
	{
		.compatible = "ti,omap5-dmm",
		.data = &dmm_omap5_platform_data,
	},
	{
		.compatible = "ti,dra7-dmm",
		.data = &dmm_dra7_platform_data,
	},
	{},
};
```

&emsp;&emsp;因为没有具体硬件，这里所分析的都是默认的设备，具体应该根据实际硬件选择具体的设备和驱动程序。



