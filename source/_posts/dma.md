---
title: dma
date: 2021-03-04 23:08:25
tags: [Linux,dma,驱动]
categories: Linux
---

### 前言

&emsp;&emsp;Linux中关于dma的操作非常常见，一些dma驱动独立到drivers/dma/目录下，架构相关的dma操作放在arch/arm/mm/目录下，还有在drivers/base/目录下也有关于dma的驱动，以及drivers/dma-buf/目录下所形成的dma-buf架构，因此有必要梳理一下dma的框架

<!-- more -->

&emsp;&emsp;DMA（Direct Memory Access）用于在设备和内存之间直接进行数据传输而不经过CPU的一种方式，主要通过DMA控制器来实现，而DMA控制器也主要分为两种，一种是嵌入到SOC上的外部DMA控制器，另一种是设备自带的DMA控制器。

&emsp;&emsp;首先是SOC上的DMA控制器，这个控制器主要是为了解决那些自身不带DMA控制器的设备也能进行DMA传输，其他的设备通过向这个总DMA控制器注册来实现DMA传输。

![DMA](https://res.cloudinary.com/flyingcatz/image/upload/v1614875686/samples/DMA/DMA_ut94kz.png)

&emsp;&emsp;而对于那些自身携带DMA控制器的设备来说，他们可以独自实现DMA传输。

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614875686/samples/DMA/DMA_device_oxv55a.png" alt="DMA_device" style="zoom: 25%;" />

&emsp;&emsp;其中，Descriptor描述DMA传输过程中的各种属性。DMA传输使用的是物理地址，而且所处理的buffer必须是物理上连续的。且CPU访问内存都是通过cache，但DMA不能访问cache，所以需要注意cache一致性，ARM架构通过clean、invalid操作来完成。在进行内存到设备传输时，要确保已经将cache中的内容写到内存上；在进行设备到内存传输时，从内存上读取数据之前需要确保将cache中对应的数据无效。



### 一、总体分析

&emsp;&emsp;内核通常使用的地址是虚拟地址。我们调用kmalloc()、vmalloc()或者类似的接口返回的地址都是虚拟地址，保存在"void *"的变量中。虚拟内存系统（TLB、页表等）将虚拟地址（程序角度）翻译成物理地址（CPU角度），物理地址保存在“phys_addr_t”或“resource_size_t”的变量中。对于一个硬件设备上的寄存器等设备资源，内核是按照物理地址来管理的。驱动并不能直接使用这些物理地址，必须首先通过ioremap()接口将这些物理地址映射到内核虚拟地址空间上去。

&emsp;&emsp;I/O设备使用第三种地址：“总线地址”。如果设备在MMIO地址空间（MMIO是物理地址空间的子集）中有若干的寄存器，或者该设备足够的智能，可以通过DMA执行读写系统内存的操作，这些情况下，设备使用的地址就是总线地址。在某些系统中，总线地址与CPU物理地址相同，但一般来说不同。iommus和host bridge可以在物理地址和总线地址之间进行映射。

&emsp;&emsp;下图中对应了驱动程序访问总线地址的两种方案：

![image-20200827101651829](https://res.cloudinary.com/flyingcatz/image/upload/v1614875688/samples/DMA/image-20200827101651829_ynif9a.png)

1. 在设备初始化过程中，内核了解了所有的IO device及其对应的MMIO地址空间，CPU并不能通过总线地址A直接访问总线上的设备，host bridge会在MMIO（即物理地址）和总线地址之间进行mapping，因此，对于CPU，它实际上是可以通过B地址（位于MMIO地址空间）访问设备。驱动程序通过ioremap()把物理地址B映射成虚拟地址C，这时候，驱动程序就可以通过虚拟地址C来访问总线上的地址A了。

2. 如果设备支持DMA，那么在驱动中可以通过kmalloc或者其他类似接口分配一个DMA buffer，并且返回了虚拟地址X，MMU将X地址映射成了物理地址Y，从而定位了DMA buffer在系统内存中的位置，驱动可以通过访问地址X来操作DMA buffer。但是设备不能通过X地址来访问DMA buffer，因为MMU对设备不可见，而且系统内存所在的系统总线和PCI总线属于不同的地址空间。在一些简单的系统中，设备可以通过DMA直接访问物理地址Y，但是在大多数的系统中，有一个IOMMU的硬件用来将DMA可访问的总线地址翻译成物理地址，也就是把上图中的地址Z翻译成Y。驱动在调用dma_map_single这样的接口函数的时候会传递一个虚拟地址X，在这个函数中会设定IOMMU的页表，将地址X映射到Z，并且将返回z这个总线地址。驱动可以把Z这个总线地址设定到设备上的DMA相关的寄存器中。这样，当设备发起对地址Z开始的DMA操作的时候，IOMMU可以进行地址映射，并将DMA操作定位到Y地址开始的DMA buffer。



### 二、DMA访问限制

&emsp;&emsp;如果驱动是通过伙伴系统的接口（例如__get_free_page*()）或者类似kmalloc() or kmem_cache_alloc()这样的通用内存分配的接口来分配DMA buffer，那么这些接口函数返回的虚拟地址可以直接用于DMA mapping接口API，并通过DMA操作在外设和dma buffer中交换数据。但vmalloc()接口分配的DMA buffer不能直接使用，因为其物理内存不连续。

&emsp;&emsp;驱动中定义的全局变量如果编译到内核则可以用于DMA操作，因为全局变量位于内核的数据段或者bss段。在内核初始化的时候，会建立kernel image mapping，因此全局变量所占据的内存都是连续的，并且VA和PA是有固定偏移的线性关系，因此可以用于DMA操作。在定义这些全局变量的DMA buffer的时候，要小心的进行cacheline的对齐，并且要处理CPU和DMA controller之间的操作同步，以避免cache coherence问题。

&emsp;&emsp;如果驱动编译成模块全局变量则不能用于DMA操作，因为驱动中全局定义的DMA buffer不在内核的线性映射区域，其虚拟地址是在模块加载的时候，通过vmalloc分配，这时候DMA buffer如果大于一个page frame，那么实际上是无法保证其底层物理地址的连续性，也无法保证VA和PA的线性关系。

&emsp;&emsp;通过kmap接口返回的内存也是不可以做DMA buffer，其原理类似vmalloc。块设备I/O子系统和网络子系统在分配buffer的时候则会确保其内存是可以进行DMA操作的。

&emsp;&emsp;根据DMA buffer的特性，DMA操作有两种：一种是streaming，DMA buffer是一次性的，用完就销毁。这种DMA buffer需要自己考虑cache一致性。另外一种是DMA buffer是cache coherent的，软件实现上比较简单，更重要的是这种DMA buffer往往是静态的、长时间存在的。有些设备有DMA寻址限制，不同的硬件平台有不同的配置方式，有的平台没有限制，外设可以访问系统内存的每一个Byte，有些则不可以。

&emsp;&emsp;不同类型的DMA操作可能有有不同的寻址限制，也可能相同。如果相同，我们可以用第一组接口设定streaming和coherent两种DMA 操作的地址掩码。如果不同，可以使用第二组的接口进行设定：

> int dma_set_mask_and_coherent(struct device *dev, u64 mask);

> int dma_set_mask(struct device *dev, u64 mask);
>
> int dma_set_coherent_mask(struct device *dev, u64 mask);



### 三、DMA映射

&emsp;&emsp;DMA映射分为两种，一种是一致性DMA映射（Consistent DMA mappings），另一种则是流式DMA映射（Streaming DMA mapping）。

1. 一致性DMA映射

   一致性DMA映射有两种特点：

   （1）持续使用该DMA buffer，初始化的时候map，系统结束时unmap。

   （2）CPU和DMA controller在发起对DMA buffer的并行访问的时候不需要考虑cache操作，CPU和DMA controller都可以看到对方对DMA buffer的更新。

2. 流式DMA映射

   流式DMA映射是一次性的，一般是在DMA传输的时候才进行map，一旦DMA传输完成就立刻unmap。

   

   ![image-20200829090605153](https://res.cloudinary.com/flyingcatz/image/upload/v1614875688/samples/DMA/image-20200829090605153_l6swsx.png)

&emsp;&emsp;可以看到，cmem驱动中所采用的就是这种一致性DMA映射。通过dma_alloc_coherent()函数接口分配并映射了一个较大（page大小或类似）的coherent DMA memory。其中dev参数就是执行该设备的struct device对象的，size参数指明了需要分配DMA buffer的大小，以字节为单位，dma参数为返回的总线地址，最后一个参数为分配内存的标志，返回的参数为此块buffer的虚拟地址，供CPU使用。

&emsp;&emsp;dma_alloc_coherent()函数所申请的内存是PAGE_SIZE对齐的，以PAGE_SIZE为单位申请buffer，而且此函数可以运行在进程上下文和中断上下文。

![image-20200829092028125](https://res.cloudinary.com/flyingcatz/image/upload/v1614875689/samples/DMA/image-20200829092028125_z3sk9c.png)

&emsp;&emsp;当所申请的buffer已经使用完，需要取消映射并释放此块内存，dma_free_coherent()函数直接取消内存的映射并释放内存，其中第三个参数为内存的虚拟地址，第四个参数为bus addr，与dma_alloc_coherent()函数不同的是，dma_free_coherent()函数只能运行在进程上下文而不能运行在中断上下文，在某些平台释放DMAbuffer的时候会引发TLB维护的操作，从而引起cpu core之间的通信，如果关闭了IRQ会锁死在SMP IPI的代码中。



&emsp;&emsp;在所申请的大块内存中还会分成很多个pool，这里是通过堆相关的函数来进行管理的，通过HeapMem_alloc()函数从大块内存中申请一个pool，HeapMem_free()则释放一个pool，具体不继续分析。

&emsp;&emsp;这里继续分析流式DMA映射的接口函数，流式DMA映射有两个版本的接口函数，一种是用来map/umap单个dma buffer，另一种用来map/umap形成scatterlist的多个dma buffer。

1. 单个dma buffer映射

   &emsp;&emsp;映射单个dma buffer的接口函数为dma_map_single()，传入的参数为struct device设备结构，虚拟地址，内存大小以及DMA操作的方向。

   ```C
   dma_handle = dma_map_single(dev, addr, size, direction); 
   ```

   &emsp;&emsp;umap单个dma buffer使用dma_unmap_single()接口函数

   ```C
   dma_unmap_single(dev, dma_handle, size, direction);
   ```

2. 多个形成scatterlist的dma buffer

   &emsp;&emsp;在scatterlist的情况下，需要映射的对象是分散的若干段dma buffer，通过dma_map_sg将scatterlist结构中的多个dma buffer映射成一个大块的、连续的bus address region。

   ```C
   int i, count = dma_map_sg(dev, sglist, nents, direction);
   struct scatterlist *sg;
   
   for_each_sg(sglist, sg, count, i) { 
       hw_address[i] = sg_dma_address(sg); 
       hw_len[i] = sg_dma_len(sg); 
   }
   ```

   &emsp;&emsp;umap多个形成scatterlist的dma buffer是通过下面的接口实现的

   ```C
   dma_unmap_sg(dev, sglist, nents, direction);
   ```

   &emsp;&emsp;调用dma_unmap_sg的时候要确保DMA操作已经完成，另外，传递给dma_unmap_sg的nents参数需要等于传递给dma_map_sg的nents参数，而不是该函数返回的count。

   &emsp;&emsp;执行流式DMA映射的时候需要考虑CPU和设备之间数据的同步问题，以保证设备看到的数据和CPU看到的数据是一样的。所以，在进行映射DMA映射，完成传输之后，需要调用相关的函数来进行同步

   ```C
   dma_sync_single_for_cpu(dev, dma_handle, size, direction);
   //或者
   dma_sync_sg_for_cpu(dev, sglist, nents, direction);
   ```

   

&emsp;&emsp;由于DMA地址空间在某些CPU架构上是有限的，因此分配并map可能会产生错误，所以需要判断过程中是否产生了错误以及出错之后的处理

* 检查dma_map_single和dma_map_page返回的dma address

  ```C
  dma_addr_t dma_handle;
  
  dma_handle = dma_map_single(dev, addr, size, direction); 
  if (dma_mapping_error(dev, dma_handle)) { 
  	goto map_error_handling; 
  }
  ```

* 当在mapping多个page的时候，如果中间发生了mapping error，那么需要对那些已经mapped的page进行unmap的操作

  ```C
  dma_addr_t dma_handle1; 
  
  dma_handle1 = dma_map_single(dev, addr, size, direction); 
  if (dma_mapping_error(dev, dma_handle1)) { 
      goto map_error_handling1; 
  } 
  ```




### 四、DMA驱动分析以及初始化配置

&emsp;&emsp;上面只分析了DMA的执行流程，但是其初始化过程以及驱动的配置方案全都没有分析，接下来会继续分析剩下的部分。下图为DMA框架的大体流程：



​		![dma框架](https://res.cloudinary.com/flyingcatz/image/upload/v1614875687/samples/DMA/dma%E6%A1%86%E6%9E%B6_ogfn0e.svg)



&emsp;&emsp;硬件环境为ARMv7架构，SOC为TI的AM5728，SOC上内置一个DMA控制器。Linux内核中对DMA的支持通过DMA ENGINE架构，具体的实现分为Provider、Consumer以及DMA Buffer三个方面。三种抽象为：

&emsp;&emsp;Provider：就是指SOC上的DMA Controller

&emsp;&emsp;Consumer：那些能利用DMA搬移数据的片上外设，例如MMC、USB Controller等

&emsp;&emsp;DMA Buffer：DMA传输过程中需要用到的数据缓冲

#### 4.1 Provider

&emsp;&emsp;Provider所抽象的是SOC上的DMA控制器，它的驱动实现是与具体架构相关，以及传输过程中cache同步问题都在架构相关的文件中，涉及到的文件主要有`arch/arm/mm/dma-mapping.c`、`arch/arm/kernel/dma.c`、`arch/arm/mach-omap2/dma.c`、`arch/arm/plat-omap/dma.c`、`drivers/base/dma-mapping.c`、`drivers/base/dma-coherent.c`、`drivers/base/*`、`drivers/dma/*`等文件

**arch/arm/mm/dma-mapping.c：**主要实现由上层传来的分配buffer、从CMA区域分配buffer、带cache操作的分配buffer等操作的具体实现

**arch/arm/kernel/dma.c：**主要实现dma channel以及channel的各种操作，包括分配channel、释放channel等，其中还包括在procfs中创建接口

**arch/arm/mach-omap2/dma.c：**为设备树文件解析出来的plat-form节点分配内存并映射到内存中，初始化其中的部分数据

**arch/arm/plat-omap/dma.c：**解析出来的plat-form节点驱动和设备节点的初始化以及注册到内核，还包括中断的处理和注册

**drivers/base/dma-mapping.c：**对base目录下的coherent和contiguous两个关于dma文件的抽象，相当于一个核心层

**drivers/base/dma-coherent.c：**对于CMA及其他关于连续内存的操作

**drivers/dma/omap-dma.c：**dma engine驱动的具体实现，根据具体硬件SOC上的DMA控制器实现相应的驱动，包括omap dma驱动、dma-crossbar驱动、virt-dma驱动等

**drivers/dma/dmaengine.c：**抽象出的dmaengine架构，在上层将各种dma控制器的驱动抽象到一起，构成一层核心层

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614875687/samples/DMA/dma_seq_dduobt.png" alt="dma_seq" style="zoom: 25%;" />

#### 4.2 Consumer

&emsp;&emsp;Consumer则是利用DMA进行传输的其他外设，他们通过dmaengine提供的统一的接口去调用更底层的DMA驱动，如上图中的最上层就是提供给Consumer使用的。Consumer作为slave端，需要遵守一定的规则去进行DMA传输：

1. 分配一个DMA slave channel

2. 设置slave和DMA控制器特殊的参数

3. 获取一个描述DMA传输的descriptor

4. 提交传输

5. 发出DMA请求并等待反馈信息

     

#### 4.3 DMA Buffer

&emsp;&emsp;DMA传输根据方向可以分为device to memory、memory to device、device to device、memory to memory四种，其中memory to memory有自己专有的一套API，以async_开头，最后，因为mem2mem的DMA传输有了比较简洁的API，没必要直接使用dma engine提供的API，最后就导致dma engine所提供的API就特指为Slave-DMA API（即其他三种DMA传输）

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614875686/samples/DMA/dma_tx_i7hscd.png" alt="dma_tx" style="zoom: 33%;" />

&emsp;&emsp;当传输的源或者目的地是memory的时候，为了提高效率，DMA controller不会每一次传输都访问memory，而是在内部开一个buffer，将数据缓存在自己buffer中：

* memory是源的时候，一次从memory读出一批数据保存在自己的buffer中，然后再一点点（以时钟为节拍）传输到目的地

* memory是目的地的时候，先将源的数据传输到自己的buffer中，当累计到一定数量之后，再一次性写入memory

  DMA控制器内部可缓存的数据量的大小称作burst size

  

&emsp;&emsp; 一般的DMA控制器只能访问物理地址连续的内存，但在有些场景下，我们只有一些物理地址不连续的内存块，需要DMA把这些内存块的数据搬移到别处，这种场景称为scatter-gather。

&emsp;&emsp;实现scatter-gather也有两种方式，一种是在DMA核心层提供scatter-gather的能力，用软件去模拟。这种方式需要先将内存块的数据搬移到一个连续的地址，然后让DMA从这个新地址开始搬移。另一种是DMA控制器本身支持scatter-gather，直接配置控制器即可，在软件上需要准备一个table或link-list，这里不继续深入分析。



### 五代码分析

&emsp;&emsp;linux内核版本4.4.19，分析的方向为自底向上，从最底层架构相关到DMA驱动最后到其他驱动调用DMA接口

#### 5.1 架构相关

&emsp;&emsp;在DMA相关的操作中，有关架构的操作和系统初始化是先于设备初始化的，系统初始化阶段会完成底层架构操作与base层的绑定，具体流程大致为

<img src="https://res.cloudinary.com/flyingcatz/image/upload/v1614875687/samples/DMA/dma_seq_arch_gse1vd.png" alt="dma_seq_arch" style="zoom: 25%;" />

&emsp;&emsp;其中，在初始化过程中就会完成DMA操作的定义，主要是完成DMA控制器与架构相关操作的实现，通过上层的调用能够执行最底层的DMA操作，当在驱动中去调用DMA的接口函数时，则直接调用与底层架构相关的函数接口，完成所需动作，具体函数调用流程为：

![func_seq](https://res.cloudinary.com/flyingcatz/image/upload/v1614875688/samples/DMA/func_seq_xkxvvq.png)

&emsp;&emsp;这个过程主要是实现最底层的DMA操作，其中最主要的就是arm_dma_ops结构体的实现和注册

![image-20200921145912242](https://res.cloudinary.com/flyingcatz/image/upload/v1614875689/samples/DMA/image-20200921145912242_hhyelf.png)

&emsp;&emsp;先分析arm_dma_alloc函数，它主要是获取DMA所需的buffer，这里需要先声明一些关于页表的类型和操作，所有的物理页面都是4k对齐的，因此所有表项的地址只需要高20位，而低12位则用于记录页面的状态信息和访问权限，即pgprot_t类型。

![image-20200921150114291](https://res.cloudinary.com/flyingcatz/image/upload/v1614875689/samples/DMA/image-20200921150114291_nijvbe.png)

&emsp;&emsp;这里主要是执行第二个函数\_\_dma\_alloc，根据设备的不同，所分配的页面位置和页面类型也是不同的，如果只是普通的分配页面则执行simple\_buffer的分配，如果是CMA内存区域则直接从所保留的内存区域分配页面，CMA的分析参考上一篇，如果是流式DMA buffer则和普通的页面分配是一样的，还有一种从pool中分配页面和remap页面，暂不分析其用途

![image-20200921155220167](https://res.cloudinary.com/flyingcatz/image/upload/v1614875689/samples/DMA/image-20200921155220167_vziqns.png)

&emsp;&emsp;我们这里是流式DMA，所以所分配的buffer是通过\_\_alloc\_simple\_buffer函数，传入的参数分别为设备节点、buffer大小、页面标志，\_\_alloc\_simple\_buffer则继续向下调用\_\_dma\_alloc\_buffer，其最终通过底层页分配器的接口--alloc_pages实现buffer的分配

![image-20200921161715546](https://res.cloudinary.com/flyingcatz/image/upload/v1614875689/samples/DMA/image-20200921161715546_oett5j.png)

&emsp;&emsp;页分配器的工作原理后续再分析，其他函数的实现也暂不继续分析

#### 5.2 DMA驱动

&emsp;&emsp;首先看DMA对应在设备树中的节点

```C
	...
				sdma_xbar: dma-router@b78 {
					compatible = "ti,dra7-dma-crossbar";
					reg = <0xb78 0xfc>;
					#dma-cells = <1>;
					dma-requests = <205>;
					ti,dma-safe-map = <0>;
					dma-masters = <&sdma>;
				};

				edma_xbar: dma-router@c78 {
					compatible = "ti,dra7-dma-crossbar";
					reg = <0xc78 0x7c>;
					#dma-cells = <2>;
					dma-requests = <204>;
					ti,dma-safe-map = <0>;
					dma-masters = <&edma>;
				};
	...
		sdma: dma-controller@4a056000 {
			compatible = "ti,omap4430-sdma";
			reg = <0x4a056000 0x1000>;
			interrupts = <GIC_SPI 7 IRQ_TYPE_LEVEL_HIGH>,
				     <GIC_SPI 8 IRQ_TYPE_LEVEL_HIGH>,
				     <GIC_SPI 9 IRQ_TYPE_LEVEL_HIGH>,
				     <GIC_SPI 10 IRQ_TYPE_LEVEL_HIGH>;
			#dma-cells = <1>;
			dma-channels = <32>;
			dma-requests = <127>;
		};

		edma: edma@43300000 {
			compatible = "ti,edma3-tpcc";
			ti,hwmods = "tpcc";
			reg = <0x43300000 0x100000>;
			reg-names = "edma3_cc";
			interrupts = <GIC_SPI 361 IRQ_TYPE_LEVEL_HIGH>,
				     <GIC_SPI 360 IRQ_TYPE_LEVEL_HIGH>,
				     <GIC_SPI 359 IRQ_TYPE_LEVEL_HIGH>;
			interrupt-names = "edma3_ccint", "emda3_mperr",
					  "edma3_ccerrint";
			dma-requests = <64>;
			#dma-cells = <2>;

			ti,tptcs = <&edma_tptc0 7>, <&edma_tptc1 0>;
		};
	...
        uart1: serial@4806a000 {
			compatible = "ti,dra742-uart", "ti,omap4-uart";
			reg = <0x4806a000 0x100>;
			interrupts-extended = <&crossbar_mpu GIC_SPI 67 IRQ_TYPE_LEVEL_HIGH>;
			ti,hwmods = "uart1";
			clock-frequency = <48000000>;
			status = "disabled";
			dmas = <&edma_xbar 49 0>, <&edma_xbar 50 0>;
			dma-names = "tx", "rx";
		};
```

&emsp;&emsp;在设备树中如果一个设备可以利用DMA传输，只需要在设备节点中加入dmas属性，并声明所使用的DMA控制器以及channel编号，例如uart1中所使用的edma 49和50号channel。

&emsp;&emsp;使用DMA设备有很多，为了方便管理和使用，同时也是为了利用内核中现有的驱动框架，DMA驱动的实现也是标准的总线-设备-驱动模型，在设备驱动模型中还有隐藏在幕后的kobject、class和kset，每一个kobject对应sys文件系统里的一个目录，其parent指针将形成一个树状分层结构，class则是抽象设备的高层视图，描述的是设备的集合，不包含同类型的设备的底层实现细节，kset则是kobject的顶层容器类

![device_model](https://res.cloudinary.com/flyingcatz/image/upload/v1614875689/samples/DMA/device_model-1600679671585_rn5dts.png)

&emsp;&emsp;在drivers/dma/目录中与DMA驱动相关的文件主要有dmaengine.c、edma.c、of-dma.c、omap-dma.c、ti-dma-crossbar.c、virt-dma.c，dmaengine.c是整个DMA驱动的最上层入口，在这里实现了DMA驱动模型，即上面的一些结构，还抽象了一个dma_bus总线，初始化了一个pool。omap-dma.c和edma.c分别对应SOC上面的System DMA和Enhanced DMA的驱动程序，of-dma.c实现了基于DMA的一些设备树操作，ti-dma-crossbar.c则是dma-crossbar的驱动程序，virt-dma.c对应虚拟channel。

&emsp;&emsp;首先是dmaengine.c，主要是去注册创建一个pool，这个pool是通过slab分配器实现的

```C
static int __init dmaengine_init_unmap_pool(void)
{
	int i;

	for (i = 0; i < ARRAY_SIZE(unmap_pool); i++) {
		struct dmaengine_unmap_pool *p = &unmap_pool[i];
		size_t size;

		size = sizeof(struct dmaengine_unmap_data) +
		       sizeof(dma_addr_t) * p->size;

        /* slab分配器接口，以后分析 */
		p->cache = kmem_cache_create(p->name, size, 0,
					     SLAB_HWCACHE_ALIGN, NULL);
		if (!p->cache)
			break;
        /* slab分配器接口，以后分析 */
		p->pool = mempool_create_slab_pool(1, p->cache);
		if (!p->pool)
			break;
	}

	if (i == ARRAY_SIZE(unmap_pool))
		return 0;

	dmaengine_destroy_unmap_pool();
	return -ENOMEM;
}
```

&emsp;&emsp;然后是omap-dma.c，这里是dma驱动的具体实现，其中主要是probe函数，当在dma-bus总线上匹配到dma设备就会执行probe函数

```C
static int omap_dma_probe(struct platform_device *pdev)
{
	struct omap_dmadev *od;
	struct resource *res;
	int rc, i, irq;

    /* 为omap_dmadev结构体申请内存 */
	od = devm_kzalloc(&pdev->dev, sizeof(*od), GFP_KERNEL);
	if (!od)
		return -ENOMEM;

    /* 获取内存资源 */
	res = platform_get_resource(pdev, IORESOURCE_MEM, 0);
	od->base = devm_ioremap_resource(&pdev->dev, res);
	if (IS_ERR(od->base))
		return PTR_ERR(od->base);

	od->plat = omap_get_plat_info();
	if (!od->plat)
		return -EPROBE_DEFER;
	/* 这里都是配置od对象 */
	od->reg_map = od->plat->reg_map;
	dma_cap_set(DMA_SLAVE, od->ddev.cap_mask);
	dma_cap_set(DMA_CYCLIC, od->ddev.cap_mask);
	dma_cap_set(DMA_MEMCPY, od->ddev.cap_mask);
	od->ddev.device_alloc_chan_resources = omap_dma_alloc_chan_resources;
	od->ddev.device_free_chan_resources = omap_dma_free_chan_resources;
	od->ddev.device_tx_status = omap_dma_tx_status;
	od->ddev.device_issue_pending = omap_dma_issue_pending;
	od->ddev.device_prep_slave_sg = omap_dma_prep_slave_sg;
	od->ddev.device_prep_dma_cyclic = omap_dma_prep_dma_cyclic;
	od->ddev.device_prep_dma_memcpy = omap_dma_prep_dma_memcpy;
	od->ddev.device_config = omap_dma_slave_config;
	od->ddev.device_pause = omap_dma_pause;
	od->ddev.device_resume = omap_dma_resume;
	od->ddev.device_terminate_all = omap_dma_terminate_all;
	od->ddev.device_synchronize = omap_dma_synchronize;
	od->ddev.src_addr_widths = OMAP_DMA_BUSWIDTHS;
	od->ddev.dst_addr_widths = OMAP_DMA_BUSWIDTHS;
	od->ddev.directions = BIT(DMA_DEV_TO_MEM) | BIT(DMA_MEM_TO_DEV);
	od->ddev.residue_granularity = DMA_RESIDUE_GRANULARITY_BURST;
	od->ddev.dev = &pdev->dev;
	INIT_LIST_HEAD(&od->ddev.channels);
	spin_lock_init(&od->lock);
	spin_lock_init(&od->irq_lock);

	od->dma_requests = OMAP_SDMA_REQUESTS;
	if (pdev->dev.of_node && of_property_read_u32(pdev->dev.of_node,
						      "dma-requests",
						      &od->dma_requests)) {
		dev_info(&pdev->dev,
			 "Missing dma-requests property, using %u.\n",
			 OMAP_SDMA_REQUESTS);
	}

	for (i = 0; i < OMAP_SDMA_CHANNELS; i++) {
		rc = omap_dma_chan_init(od);
		if (rc) {
			omap_dma_free(od);
			return rc;
		}
	}

    /* 从设备树中获取中断 */
	irq = platform_get_irq(pdev, 1);
	if (irq <= 0) {
		dev_info(&pdev->dev, "failed to get L1 IRQ: %d\n", irq);
		od->legacy = true;
	} else {
		/* Disable all interrupts */
		od->irq_enable_mask = 0;
		omap_dma_glbl_write(od, IRQENABLE_L1, 0);

		rc = devm_request_irq(&pdev->dev, irq, omap_dma_irq,
				      IRQF_SHARED, "omap-dma-engine", od);
		if (rc)
			return rc;
	}

	od->ddev.filter.map = od->plat->slave_map;
	od->ddev.filter.mapcnt = od->plat->slavecnt;
	od->ddev.filter.fn = omap_dma_filter_fn;

    /* 注册OMAP-DMA设备 */
	rc = dma_async_device_register(&od->ddev);

	platform_set_drvdata(pdev, od);

	if (pdev->dev.of_node) {
		omap_dma_info.dma_cap = od->ddev.cap_mask;

		/* Device-tree DMA controller registration */
		rc = of_dma_controller_register(pdev->dev.of_node,
				of_dma_simple_xlate, &omap_dma_info);
		if (rc) {
			pr_warn("OMAP-DMA: failed to register DMA controller\n");
			dma_async_device_unregister(&od->ddev);
			omap_dma_free(od);
		}
	}

	dev_info(&pdev->dev, "OMAP DMA engine driver\n");
	return rc;
}
```

&emsp;&emsp;edma驱动中涉及到edma-tptc和edma的注册，主体还是edma的probe函数

```C
static int edma_probe(struct platform_device *pdev)
{
	struct edma_soc_info	*info = pdev->dev.platform_data;
	s8			(*queue_priority_mapping)[2];
	int			i, off, ln;
	const s16		(*rsv_slots)[2];
	const s16		(*xbar_chans)[2];
	int			irq;
	char			*irq_name;
	struct resource		*mem;
	struct device_node	*node = pdev->dev.of_node;
	struct device		*dev = &pdev->dev;
	struct edma_cc		*ecc;
	bool			legacy_mode = true;
	int ret;

	if (node) {
		const struct of_device_id *match;

		match = of_match_node(edma_of_ids, node);
		if (match && (u32)match->data == EDMA_BINDING_TPCC)
			legacy_mode = false;

		info = edma_setup_info_from_dt(dev, legacy_mode);
		if (IS_ERR(info)) {
			dev_err(dev, "failed to get DT data\n");
			return PTR_ERR(info);
		}
	}

	pm_runtime_enable(dev);
	ret = pm_runtime_get_sync(dev);

	ret = dma_set_mask_and_coherent(dev, DMA_BIT_MASK(32));

	ecc = devm_kzalloc(dev, sizeof(*ecc), GFP_KERNEL);

	ecc->dev = dev;
	ecc->id = pdev->id;
	ecc->legacy_mode = legacy_mode;
	/* When booting with DT the pdev->id is -1 */
	if (ecc->id < 0)
		ecc->id = 0;

    /* 同样获取设备的内存资源 */
	mem = platform_get_resource_byname(pdev, IORESOURCE_MEM, "edma3_cc");

	ecc->base = devm_ioremap_resource(dev, mem);
	if (IS_ERR(ecc->base))
		return PTR_ERR(ecc->base);

	platform_set_drvdata(pdev, ecc);

	/* 从硬件IP中获取edma的配置参数 */
	ret = edma_setup_from_hw(dev, info, ecc);

	/* 基于硬件IP参数申请内存 */
	ecc->slave_chans = devm_kcalloc(dev, ecc->num_channels,
					sizeof(*ecc->slave_chans), GFP_KERNEL);

	ecc->slot_inuse = devm_kcalloc(dev, BITS_TO_LONGS(ecc->num_slots),
				       sizeof(unsigned long), GFP_KERNEL);

	ecc->default_queue = info->default_queue;

	for (i = 0; i < ecc->num_slots; i++)
		edma_write_slot(ecc, i, &dummy_paramset);

	if (info->rsv) {
		/* Set the reserved slots in inuse list */
		rsv_slots = info->rsv->rsv_slots;
		if (rsv_slots) {
			for (i = 0; rsv_slots[i][0] != -1; i++) {
				off = rsv_slots[i][0];
				ln = rsv_slots[i][1];
				set_bits(off, ln, ecc->slot_inuse);
			}
		}
	}

	/* 清除xbar在unused链表中的通道映射 */
	xbar_chans = info->xbar_chans;
	if (xbar_chans) {
		for (i = 0; xbar_chans[i][1] != -1; i++) {
			off = xbar_chans[i][1];
		}
	}

    /* 获取中断 */
	irq = platform_get_irq_byname(pdev, "edma3_ccint");
	if (irq < 0 && node)
		irq = irq_of_parse_and_map(node, 0);

	irq = platform_get_irq_byname(pdev, "edma3_ccerrint");
	if (irq < 0 && node)
		irq = irq_of_parse_and_map(node, 2);

	if (irq >= 0) {
		irq_name = devm_kasprintf(dev, GFP_KERNEL, "%s_ccerrint",
					  dev_name(dev));
		ret = devm_request_irq(dev, irq, dma_ccerr_handler, 0, irq_name,
				       ecc);
		if (ret) {
			dev_err(dev, "CCERRINT (%d) failed --> %d\n", irq, ret);
			return ret;
		}
	}

	ecc->dummy_slot = edma_alloc_slot(ecc, EDMA_SLOT_ANY);
	if (ecc->dummy_slot < 0) {
		dev_err(dev, "Can't allocate PaRAM dummy slot\n");
		return ecc->dummy_slot;
	}

	queue_priority_mapping = info->queue_priority_mapping;

	/* 事件队列优先映射 */
	for (i = 0; queue_priority_mapping[i][0] != -1; i++)
		edma_assign_priority_to_queue(ecc, queue_priority_mapping[i][0],
					      queue_priority_mapping[i][1]);

	for (i = 0; i < ecc->num_region; i++) {
		edma_write_array2(ecc, EDMA_DRAE, i, 0, 0x0);
		edma_write_array2(ecc, EDMA_DRAE, i, 1, 0x0);
		edma_write_array(ecc, EDMA_QRAE, i, 0x0);
	}
	ecc->info = info;

	/* 初始化dma设备和channels */
	edma_dma_init(ecc, legacy_mode);

	for (i = 0; i < ecc->num_channels; i++) {
		/* 分配所有的channels到默认的队列 */
		edma_assign_channel_eventq(&ecc->slave_chans[i],
					   info->default_queue);
		/* 设置虚拟slot的入口位置 */
		edma_set_chmap(&ecc->slave_chans[i], ecc->dummy_slot);
	}

	ecc->dma_slave.filter.map = info->slave_map;
	ecc->dma_slave.filter.mapcnt = info->slavecnt;
	ecc->dma_slave.filter.fn = edma_filter_fn;

	ret = dma_async_device_register(&ecc->dma_slave);
	if (ret) {
		dev_err(dev, "slave ddev registration failed (%d)\n", ret);
		goto err_reg1;
	}

	if (ecc->dma_memcpy) {
		ret = dma_async_device_register(ecc->dma_memcpy);
		if (ret) {
			dev_err(dev, "memcpy ddev registration failed (%d)\n",
				ret);
			dma_async_device_unregister(&ecc->dma_slave);
			goto err_reg1;
		}
	}

	if (node)
		of_dma_controller_register(node, of_edma_xlate, ecc);

	dev_info(dev, "TI EDMA DMA engine driver\n");

	return 0;

err_reg1:
	edma_free_slot(ecc, ecc->dummy_slot);
	return ret;
}
```

&emsp;&emsp;然后是ti-dma-crossbar.c，负责dma事件映射

```C
static int ti_dra7_xbar_probe(struct platform_device *pdev)
{
	struct device_node *node = pdev->dev.of_node;
	const struct of_device_id *match;
	struct device_node *dma_node;
	struct ti_dra7_xbar_data *xbar;
	struct property *prop;
	struct resource *res;
	u32 safe_val;
	size_t sz;
	void __iomem *iomem;
	int i, ret;

	if (!node)
		return -ENODEV;

	xbar = devm_kzalloc(&pdev->dev, sizeof(*xbar), GFP_KERNEL);
	if (!xbar)
		return -ENOMEM;

	dma_node = of_parse_phandle(node, "dma-masters", 0);
	if (!dma_node) {
		dev_err(&pdev->dev, "Can't get DMA master node\n");
		return -ENODEV;
	}

	match = of_match_node(ti_dra7_master_match, dma_node);
	if (!match) {
		dev_err(&pdev->dev, "DMA master is not supported\n");
		return -EINVAL;
	}

	if (of_property_read_u32(dma_node, "dma-requests",
				 &xbar->dma_requests)) {
		dev_info(&pdev->dev,
			 "Missing XBAR output information, using %u.\n",
			 TI_DRA7_XBAR_OUTPUTS);
		xbar->dma_requests = TI_DRA7_XBAR_OUTPUTS;
	}
	of_node_put(dma_node);

	xbar->dma_inuse = devm_kcalloc(&pdev->dev,
				       BITS_TO_LONGS(xbar->dma_requests),
				       sizeof(unsigned long), GFP_KERNEL);
	if (!xbar->dma_inuse)
		return -ENOMEM;

	if (of_property_read_u32(node, "dma-requests", &xbar->xbar_requests)) {
		dev_info(&pdev->dev,
			 "Missing XBAR input information, using %u.\n",
			 TI_DRA7_XBAR_INPUTS);
		xbar->xbar_requests = TI_DRA7_XBAR_INPUTS;
	}

	if (!of_property_read_u32(node, "ti,dma-safe-map", &safe_val))
		xbar->safe_val = (u16)safe_val;


	prop = of_find_property(node, "ti,reserved-dma-request-ranges", &sz);
	if (prop) {
		const char pname[] = "ti,reserved-dma-request-ranges";
		u32 (*rsv_events)[2];
		size_t nelm = sz / sizeof(*rsv_events);
		int i;

		if (!nelm)
			return -EINVAL;

		rsv_events = kcalloc(nelm, sizeof(*rsv_events), GFP_KERNEL);
		if (!rsv_events)
			return -ENOMEM;

		ret = of_property_read_u32_array(node, pname, (u32 *)rsv_events,
						 nelm * 2);
		if (ret)
			return ret;

		for (i = 0; i < nelm; i++) {
			ti_dra7_xbar_reserve(rsv_events[i][0], rsv_events[i][1],
					     xbar->dma_inuse);
		}
		kfree(rsv_events);
	}

	res = platform_get_resource(pdev, IORESOURCE_MEM, 0);
	iomem = devm_ioremap_resource(&pdev->dev, res);
	if (IS_ERR(iomem))
		return PTR_ERR(iomem);

	xbar->iomem = iomem;

	xbar->dmarouter.dev = &pdev->dev;
	xbar->dmarouter.route_free = ti_dra7_xbar_free;
	xbar->dma_offset = (u32)match->data;

	mutex_init(&xbar->mutex);
	platform_set_drvdata(pdev, xbar);

	/* Reset the crossbar */
	for (i = 0; i < xbar->dma_requests; i++) {
		if (!test_bit(i, xbar->dma_inuse))
			ti_dra7_xbar_write(xbar->iomem, i, xbar->safe_val);
	}

	ret = of_dma_router_register(node, ti_dra7_xbar_route_allocate,
				     &xbar->dmarouter);
	if (ret) {
		/* Restore the defaults for the crossbar */
		for (i = 0; i < xbar->dma_requests; i++) {
			if (!test_bit(i, xbar->dma_inuse))
				ti_dra7_xbar_write(xbar->iomem, i, i);
		}
	}

	return ret;
}
```

&emsp;&emsp;最后是虚拟channel，在virt-dma.c文件中实现

```C
void vchan_init(struct virt_dma_chan *vc, struct dma_device *dmadev)
{
	dma_cookie_init(&vc->chan);

	spin_lock_init(&vc->lock);
	INIT_LIST_HEAD(&vc->desc_allocated);
	INIT_LIST_HEAD(&vc->desc_submitted);
	INIT_LIST_HEAD(&vc->desc_issued);
	INIT_LIST_HEAD(&vc->desc_completed);

	tasklet_init(&vc->task, vchan_complete, (unsigned long)vc);

	vc->chan.device = dmadev;
	list_add_tail(&vc->chan.device_node, &dmadev->channels);
}
```

#### 5.3 具体实例

&emsp;&emsp;这里给出一个实际驱动中调用dma传输的一个例子，在cmem驱动中通过一致性dma接口分配了buffer，调用v7\_dma\_map\_area函数实现cache的同步和dma传输

![image-20200923091128578](https://res.cloudinary.com/flyingcatz/image/upload/v1614875689/samples/DMA/image-20200923091128578_w4xg1t.png)

