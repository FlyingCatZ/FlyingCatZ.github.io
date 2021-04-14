---
title: CMA
date: 2021-02-13 22:55:30
tags:
  - Linux
  - 内存
categories: Linux
---

#### 前言

&emsp;&emsp;CMA（Contiguous Memory Alloctor 连续内存分配器）是Linux内存管理子系统中的一个模块，负责物理地址连续的内存分配。一般系统会在启动过程中，从整个memory中配置一段连续内存用于CMA，然后内核其他的模块可以通过CMA的接口API进行连续内存的分配，它的底层还是依赖内核伙伴系统这样的内存管理机制。

<!-- more -->

&emsp;&emsp;问：为什么需要CMA模块？

&emsp;&emsp;在嵌入式设备中，很多设备往往需要 较大的内存缓冲区（如: 一个200万像素的高清帧摄像机，需要超过 6M 的内存)， kmalloc 内存分配机制对于这么大的内存是没有效果的。一些嵌入式设备对缓冲区 有一些额外的要求，比如： 在含有多个内存 bank 的设备中，要求只能在特定的 bank 中分配内存；而还有一些要定内存边界对齐的缓存区。近来，嵌入式设备有了较大的发展（特别是 V4L 领域），并且这些驱动都有自己的内存分配代码。CMA 框架企图采用统一的连续内存分配机制，并为这些设备驱动提供简单的API，实现定制化和模块化，而且CMA可以实现物理连续内存在不使用时这片内存能够被其他模块"借用"，需要的时候将其移走即可，还有就是：

&emsp;&emsp;1.huge page（超过4k的页）模块分配  

&emsp;&emsp;2.驱动需求，在嵌入式设备中如果没有IOMMU（设备访问的内存管理），而且DMA也不具备scatter/getter功能（IO分散聚集接口），这时必须通过CMA进行物理连续内存的分配



![内存视图](https://res.cloudinary.com/flyingcatz/image/upload/v1613226806/samples/CMA/%E5%86%85%E5%AD%98%E7%AE%A1%E7%90%86_udx01r.svg)



#### 设备树配置

&emsp;&emsp;设备树中对保留内存进行设置的参数在Documentation/devicetree/bindings/reserved-memory/reserved-memory.txt文档中有说明：

&emsp;&emsp;在/reserved-memory节点中必须有#address-cells，#size-cells两个参数指定地址、大小参数的个数，ranges参数必须有，且为空。

&emsp;&emsp;在/reserved-memory里面的每一个子节点都可以通过两种方式来分配内存，一种为静态方式（static allocation），用reg属性指定分配内存的地址和大小。另一种为动态方式（dynamic allocation），用size属性指定大小，alignment指定对其大小，alloc-ranges指定可接受分配的内存区域，后面两个参数是可选的，第一个参数必须有。

&emsp;&emsp;子节点中还有compatible属性指定所分配内存区域是公有的还是私有的，no-map属性指定不映射到内核区域（一般用于专有驱动），也就是说初始化时不创建内存映射，由驱动进行ioremap，reusable属性指定该区域可以存储易失性数据或缓存数据，linux,cma-default属性指定使用CMA默认的池。

&emsp;&emsp;Linux4.4版本中/reserved-memory节点中保留的内存四块是给DSP和IPU用，设置为公有区域，用于与其他核通信，两块专门留给cmem驱动程序使用，默认为私有属性，只有cmem驱动能够访问。其中cmem的第一块内存为0xa0000000开始的192MB空间，第二块内存为0x40500000开始的1MB空间。

```C
reserved-memory {
		#address-cells = <0x2>;
		#size-cells = <0x2>;
		ranges;
		...

		cmem_block_mem@a0000000 {
			reg = <0x0 0xa0000000 0x0 0xc000000>;
			no-map;
			status = "okay";
			phandle = <0xef>;
		};

		cmem_block_mem@40500000 {
			reg = <0x0 0x40500000 0x0 0x100000>;
			no-map;
			status = "okay";
			phandle = <0xf0>;
		};
	};
```

&emsp;&emsp;CMA预留内存的方式有三种，

&emsp;&emsp;第一种：给CMA内存池分配一块固定的内存，不分配给特定的设备驱动程序，以预留的内存区域用作默认的CMA内存池。

&emsp;&emsp;第二种：预留内存给特定的设备驱动使用，通常在设备树中指定好各项参数，驱动程序通过解析设备树节点来处理内存区域的属性，并且通过物理地址和大小使用memremap / ioremap等API映射内存区域使用。

&emsp;&emsp;需要注意的是：事实上，多数设备驱动不能直接调用CMA API，因为它是在页和页帧编号（PFNs）上操作而无关总线地址和内核映射，并且也不提供维护缓存一致性的机制。

&emsp;&emsp;第三种：通过DMA API预留内存，有的时候设备驱动程序需要采用DMA的方式使用预留的内存，对于这种场景，可以将dts中节点属性设置为shared-dma-pool，从而生成为特定设备驱动程序预留的DMA内存池。设备驱动程序仅需要以常规方式使用DMA API，无需使用默认的CMA内存池。

&emsp;&emsp;一般驱动都是用第三种方式。

&emsp;&emsp;另外，配置CMA内存还可以通过**命令行参数**和**内核Kbuild配置**。



#### 初始化过程

&emsp;&emsp;这里在配置文件中配置了CONFIG_NO_BOOTMEM选项，表示完全使用memblock内存分配器代替bootmem内存分配器。memblock内存分配器是Linux内核启动过程中早期的内存分配器，主要负责从设备树上面解析内存信息，从而确定整个系统的的内存布局，通过解析设备树节点/reserved-memory读取保留的内存范围，将每块内存信息添加到memblock.reserved内存块中的数组中，memblock.reserved中的内存都是已经分配出去的内存。armv7架构中（内核4.4）调用过程为

`start_kernel()`->`setup_arch()`->`setup_machine_fdt()`->`early_init_dt_scan()`

->`early_init_dt_scan_nodes`->`early_init_dt_scan_memory()`

->`early_init_dt_add_memory_arch()`->`memblock_add()`

&emsp;&emsp;最终通过memblock_add函数把所有内存添加到memblock.memory中，把已分配出去的内存添加到memblock.reserved中，通过memblock.memory构建起整个内存的框架。

![cma](https://res.cloudinary.com/flyingcatz/image/upload/v1613225688/samples/CMA/image-20200808154317486_nznjzi.png)

​		

&emsp;&emsp;CMA通过在启动阶段预先保留内存，这些内存叫做CMA区域或CMA上下文，这些内存需要通过CMA接口来进行分配，在进行CMA区域的初始化之前通过early_init_fdt_scan_reserved_mem()函数保留内存，它向下调用memblock_alloc_range_nid()函数，首先调用memblock_find_in_range_node()函数遍历memblock.memory内存块中的数组从中找到指定的区域分配，在通过membloc_reserve()函数将分配出去的内存添加到memblock.reserved中，最后通过kmemleak_alloc_phys()建立CMA内存区域对象，稍后返回给伙伴系统从而可以被用作正常申请使用。

![cma2](https://res.cloudinary.com/flyingcatz/image/upload/v1613226912/samples/CMA/image-20200817145111816_m8nffr.png)

​		

&emsp;&emsp;arm_memblock_init() 函数中函数调用了 early_init_fdt_scan_reserved_mem() 函数，该函数 从 DTB 中将所有预留区的信息读取出来，然后从 MEMBLOCK 分配器中申请指定长度的物理内存，并将这些预留区加入到系统预留区数组 reserved-mem[] 进行管理，以供后期内核初始化使用。

&emsp;&emsp;在伙伴系统建立之前调用dma_contiguous_reserve函数对CMA区域进行初始化，通过cma_declare_contiguous()函数建立起CMA区域专有内存。

&emsp;&emsp;调用过程为 

`start_kernel()`->`setup_arch()`->`arm_memblock_init()`->`dma_contiguous_reserve()` 

->`dma_contiguous_reserve_area()`->`cma_declare_contiguous()`

&emsp;&emsp;输出打印：

![cma3](https://res.cloudinary.com/flyingcatz/image/upload/v1613227021/samples/CMA/image-20200810171949718_yjdmuh.png)



&emsp;&emsp;接下来需要对这块区域进行初始化，如果compitable设置为"shared-memory-pool"，也就是将CMA区域设置为公有区域，则会调用RESERVEDMEM_OF_DECLARE宏，在\_\_reservedmem\_of\_table节中插入新的CMA区域数据，在函数中调用 \_\_reserved_mem_init_node() 函数遍历 \_\_reservedmem_of_table section, 该 section 内包含了 对预留区的初始化函数。

`setup_arch()`->`arm_memblock_init()`->`early_init_fdt_scan_reserved_mem()`

->`fdt_init_reserved_mem()`->`__reserved_mem_init_node`

![cma4](https://res.cloudinary.com/flyingcatz/image/upload/v1613227091/samples/CMA/image-20200808161916566_ve5wvp.png)

&emsp;&emsp;输出打印：

![cma5](https://res.cloudinary.com/flyingcatz/image/upload/v1613227207/samples/CMA/image-20200810172634847_doptye.png)



&emsp;&emsp;如果是私有的CMA区域，需要驱动程序去申请内存并进行初始化映射，而且在驱动中需要通过dma_declare_contiguous函数与对应的CMA区域绑定。

![cma6](https://res.cloudinary.com/flyingcatz/image/upload/v1613227266/samples/CMA/image-20200808172920300_mj3phn.png)



&emsp;&emsp;此时CMA区域已经构建完成，但页表还没有构建起来，需要为CMA区域构建页表，同样是对公有区域，私有区域需要驱动程序实现。在setup\_arch函数中初始化完CMA区域紧接着就是paging\_init函数，其为CMA建立对应的页表。它会向下继续调用dma_contiguous_remap函数，为cma_mmu_remap数组中每一个区域建立页表。

&emsp;&emsp;调用过程为 setup\_arch() -> paging_init() -> dma\_contiguous\_remap() -> flush\_tlb\_kernel\_range() & iotable\_init()

![cma7](https://res.cloudinary.com/flyingcatz/image/upload/v1613227340/samples/CMA/image-20200812161305165_flc9b2.png)

&emsp;&emsp;至此，CMA内存区域的初始化就完成了。



#### CMA分配器初始化

&emsp;&emsp;我们需要对CMA区域中的内存进行申请、释放，这些都是通过CMA分配器实现。内核初始化过程中，通过 core_initcall() 函数将该section内的初始化函数遍历执行，其中包括 CMA 的激活入口cma_init_reserved_areas()函数， 该函数遍历分配的所有CMA分区并激活每一个CMA分区。该函数向下调用cma_activate_area()函数激活每一个区域。

&emsp;&emsp;调用过程 core_initcall(cma_init_reserved_areas) -> cma\_activate\_area()

![cma8](https://res.cloudinary.com/flyingcatz/image/upload/v1613227416/samples/CMA/image-20200812163139293_hui0nn.png)



&emsp;&emsp;在该函数中， 函数首先调用 kzalloc() 函数为CMA分区的bitmap所需的内存，然后调用init_cma_reserved_pageblock()函数。在该函数中，内核将 CMA 区块内的所有物理页都清除RESERVED标志，引用计数设置为0，接着按pageblock的方式设置区域内的页组迁移类型为MIGRATE_CMA。函数继续调用set_page_refcounted()函数将引用计数设置为1以及调用\_\_free\_pages()函数将所有的页从CMA分配器中释放并归还给buddy管理器。最后调用adjust_managed_page_count()更新系统可用物理页总数。

&emsp;&emsp;至此系统的其他部分可以开始使用CMA分配器分配的连续物理内存。

![cma9](https://res.cloudinary.com/flyingcatz/image/upload/v1613227504/samples/CMA/image-20200813134715265_mpnevf.png)



#### 通过CMA分配连续内存

&emsp;&emsp;CMA内存的分配在多数情况下不能直接被驱动程序所调用，都是通过对dma接口进行重构，实现用dma接口访问。对分配的buffer通过dma-buf实现共享，最重要的是实现零拷贝，这里还需要说明一下dma-buf：

&emsp;&emsp;dma-buf是内核中的一个子系统，实现了一个让不同设备、子系统之间进行共享缓存的统一框架。本质上是 buffer 与 file 的结合，即 dma-buf 既是块物理 buffer，又是个 linux file。buffer 是内容，file 是媒介，只有通过 file 这个媒介才能实现同一 buffer 在不同驱动之间的流转。

&emsp;&emsp;dma_buf子系统包含三个主要组成:

1. dma-buf对象，它代表的后端是一个sg_table结构，它暴露给应用层的接口是一个文件描述符，通过传递描述符达到了交互访问dma-buf对象，进而最终达成了共享访问sg_table的目的。
2. fence对象, 它提供了在一个设备完成访问时发出信号的机制。
3. reservation对象, 它负责管理缓存的分享和互斥访问。

![未命名表单](https://res.cloudinary.com/flyingcatz/image/upload/v1613227603/samples/CMA/%E6%9C%AA%E5%91%BD%E5%90%8D%E8%A1%A8%E5%8D%95_ezof0e.svg)



&emsp;&emsp;在CMEM驱动中，初始化过程中调用dma_declare_contiguous()函数实现cma保留内存并对其进行初始化。它会向下调用cma_declare_contiguous()函数，从而与cma接口对接起来。

&emsp;&emsp;dma申请内存时有两种缓冲区映射方式，一种是一致性缓冲区映射，另一种是流式缓冲区映射，他们最大的区别就是一致性缓冲区映射可同时供多个设备访问，而流式缓冲区映射一次只能有一个设备访问。

&emsp;&emsp;per-device通过dma接口申请内存时，采用标准的接口dma_alloc_coherent()，通过dma_map_ops结构体间接调用dma_alloc_from_contiguous函数，从而分配内存。

&emsp;&emsp;调用过程：

`dma_alloc_coherent()` --> `dma_alloc_attrs()` --> `ops()` -->`alloc()` --> `arm_coherent_dma_alloc()` --> `__dma_alloc()` --> `__alloc_from_contiguous()` --> `dma_alloc_from_contiguous()`

&emsp;&emsp;这里通过dma-buf架构使用标准dma接口dma_alloc_coherent()向下调用cma接口，这个过程是通过注册dma-buf数据结构时完成的。构建dma-buf时，需要有dma_buf_ops结构体，通过DEFINE_DMA_BUF_EXPORT_INFO宏重定义exp_info结构体，最后调用dma_buf_export()函数导出，这些操作封装在cmem_dmabuf_export()函数中。

![image-20200818140019342](https://res.cloudinary.com/flyingcatz/image/upload/v1613227667/samples/CMA/image-20200818140019342_xcqjez.png)



&emsp;&emsp;分配内存API的另外一个接口是`dma_alloc_from_contiguous`，它是用于向下调用cma相关的操作。

![image-20200812163857604](https://res.cloudinary.com/flyingcatz/image/upload/v1613227716/samples/CMA/image-20200812163857604_u0r4qq.png)

&emsp;&emsp;释放内存API接口`dma_release_from_contiguous`

![image-20200812164007006](https://res.cloudinary.com/flyingcatz/image/upload/v1613227747/samples/CMA/image-20200812164007006_m60zej.png)



&emsp;&emsp;在CMEM的驱动中还有一个小操作就是seq_file的使用，针对proc文件的不足而诞生了Seq_file，Seq_file的实现基于proc文件，作用是将Linux内核里面常用的数据结构通过文件（主要关注proc文件）导出到用户空间。

&emsp;&emsp;主要结构为：

```C
static struct file_operations cmem_proc_ops = {
	.owner = THIS_MODULE,
	.open = cmem_proc_open,
	.read = seq_read,
	.llseek = seq_lseek,
	.release = seq_release,
};
```

&emsp;&emsp;在cmem_proc_open中调用seq_open注册cmem_seq_ops

```C
static struct seq_operations cmem_seq_ops = {
	.start = cmem_seq_start,
	.next = cmem_seq_next,
	.stop = cmem_seq_stop,
	.show = cmem_seq_show,
};
```

&emsp;&emsp;需要用户实现这四个函数



#### CMA 核心数据结构

![image-20200818145054898](https://res.cloudinary.com/flyingcatz/image/upload/v1613227808/samples/CMA/image-20200818145054898_vwfy8d.png)

&emsp;&emsp;struct cma 结构用于维护一块 CMA 区域， CMA 分配器维护着所有可用的 CMA 区域，每个 CMA 区域都是一段连续的物理内存。



![image-20200818145229775](https://res.cloudinary.com/flyingcatz/image/upload/v1613227843/samples/CMA/image-20200818145229775_apd5h8.png)

&emsp;&emsp;cma_areas 是一个 struct cma 数组，由于维护 CMA 分配器中可用的 CMA 区域。cma_area_count 变量用于指向当前最大可用的 CMA 区域数量。



![image-20200818145706223](https://res.cloudinary.com/flyingcatz/image/upload/v1613227872/samples/CMA/image-20200818145706223_bd21qs.png)

&emsp;&emsp;reserved_mem[] 数组用于维护系统早期的预留内存区。系统初始化节点会将 CMA 区域和 DMA 区域加入到该数组。reserved_mem[] 数组总共包含 MAX_RESERVED_REGIONS 个区域，reserved_mem_count 指定了最大可用的预留区数。



