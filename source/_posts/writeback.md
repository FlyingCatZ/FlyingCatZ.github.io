---
title: writeback
date: 2021-06-07 18:04:44
tags: [Linux,文件系统,writeback]
categories: [Linux]
---

### 前言

&emsp;&emsp;writeback是将内存中的脏页缓存写回到永久存储设备的过程，主要原因是磁盘等存储设备的读写速率远远小于内存的读写速率，所以需要在内存上面建立缓存，发生数据修改时先修改内存上的缓存，这些被修改的缓存称为脏页，脏页最终需要写入到具体的硬件设备，这个过程称为回写。

<!-- more -->

### 一、writeback参数分析

#### 1.1 writeback reason

&emsp;&emsp;writeback发生有很多原因，当前内核版本5.12-rc4，触发writeback的原因如下

```C
enum wb_reason {
    WB_REASON_BACKGROUND, 		//后台回写	
    WB_REASON_VMSCAN, 			//内存压力							
    WB_REASON_SYNC, 			//系统调用回写
    WB_REASON_PERIODIC, 		//定期回写
    WB_REASON_LAPTOP_TIMER, 	//Laptop模式回写
    WB_REASON_FS_FREE_SPACE, 	//当1/2的可用块变脏时开始推送delalloc，ext4使用

    WB_REASON_FORKER_THREAD, 	//紧急情况下回写
    WB_REASON_FOREIGN_FLUSH, 	//cgroup相关回写

    WB_REASON_MAX,
};
```

&emsp;&emsp;大致可以总结writeback的原因如下

*   内存压力，当文件缓存占用太多的内存会触发writeback释放内存上的缓存（shrink_inactive_list，异步方式）
*   系统调用，当用户层主动调用sync相关的系统调用时会触发writeback（ksys_sync，异步方式，sync_inodes_sb，同步方式）
*   定时回写，每隔5s触发一次writeback（dirty_writeback_centisecs_handler，异步方式，用于处理/proc/sys/vm/dirty_writeback_centisecs文件，wb_check_old_data_flush，同步方式）
*   脏块过多，当系统中的free block小于%150 dirty block时触发writeback（ext4_nonda_switch，同步方式，ext4专用）

&emsp;&emsp;其他的writeback条件为特定条件下使用，例如laptop模式的回写。



#### 1.2 数据结构

&emsp;&emsp;在writeback中有几个重要的数据结构，分别是bdi_writeback、backing_dev_info、wb_writeback_work，这三者关系如下图

<img src="/home/jian/Documents/work/调研报告/picture_struct-1616550376390.png" alt="picture_struct" style="zoom:18%;" />

&emsp;&emsp;最顶层是一个work_queue，其他的则为

bdi_writeback：刷新脏页所需的所有信息

backing_dev_info：backing_dev的所有信息

wb_writeback_work：writeback的工作任务

```C
struct wb_writeback_work {                                                       
	long nr_pages; 						//待回写页面数量
	struct super_block *sb; 			//该writeback任务所属的super_block
	enum writeback_sync_modes sync_mode; //同步回写模式
	unsigned int tagged_writepages:1; 	//
	unsigned int for_kupdate:1;     	//若值为1，则表示回写操作是周期性的机制；否则值为0
	unsigned int range_cyclic:1;    	//若值为0，则表示回写操作范围限制在[range_start, range_end]限定范围；若值为1，则表示内核可以对 mapping 里的页面执行多次回写操作。
	unsigned int for_background:1; 		//若值为1，表示后台回写；否则值为0
	unsigned int for_sync:1;    		/* sync(2) WB_SYNC_ALL writeback */              
	unsigned int auto_free:1;   		/* free on completion */                         
	enum wb_reason reason;      		/* writeback触发原因 */
	struct list_head list;      		/* 待处理的工作链表 */
	struct wb_completion *done; 		/* 完成标志 */                    
};

/* 指定同步模式 */
enum writeback_sync_modes {                                                       	
    WB_SYNC_NONE,   /* 表示当遇到锁住的inode时，它必须等待该inode解锁，而不能跳过。 */
    WB_SYNC_ALL,    /* 表示跳过被锁住的inode */                                  
};
```

&emsp;&emsp;inode节点中的i_mapping成员保存了要写入的所有的页

```C
struct inode {
	...
	const struct inode_operations	*i_op;
	struct super_block	*i_sb;
	struct address_space	*i_mapping;
	...
	union {
		const struct file_operations	*i_fop;	/* former ->i_op->default_file_ops */
		void (*free_inode)(struct inode *);
	};
	struct file_lock_context	*i_flctx;
	struct address_space	i_data;
	struct list_head	i_devices;
};
```

&emsp;&emsp;writeback_control控制写入方式和页面的数据，可以和bio结构组成每个文件系统独有的bio结构，加上上面的inode中的address_space数据就可以构成一个bio，然后提交到io层

```C
struct writeback_control {
	long nr_to_write;		/* 要写的页数 */
	long pages_skipped;		/* 未写的页数 */

	/* 如果不为0，则为要写的页 */
	loff_t range_start;
	loff_t range_end;

	enum writeback_sync_modes sync_mode;

	unsigned for_kupdate:1;		/* 定期回写 */
	unsigned for_background:1;	/* 后台回写 */
	unsigned tagged_writepages:1;	/* 写入标记 */
	unsigned for_reclaim:1;		/* 从页面分配器调用 */
	unsigned range_cyclic:1;	/* 循环写开始位置 */
	unsigned for_sync:1;		/* sync(2) WB_SYNC_ALL 回写 */
};
```



### 二、writeback实现策略

#### 2.1 文件系统

&emsp;&emsp;不同的文件系统具有不同的性能以及适合的场景，在ext4文件系统向磁盘写入数据时有三种模式来选择日志数据的更新

```C
/*
 * Ext4 inode日志模式
 */
#define EXT4_INODE_JOURNAL_DATA_MODE	0x01 /* 日志数据模式 */
#define EXT4_INODE_ORDERED_DATA_MODE	0x02 /* 有序数据模式 */
#define EXT4_INODE_WRITEBACK_DATA_MODE	0x04 /* 写回数据模式 */
```

> - **日志**是最低风险的模式，在将数据和元数据提交到文件系统之前，将数据和元数据都写入日志。这样可以确保要写入的文件以及整个文件系统的一致性，但是会大大降低性能。
> - 在大多数Linux发行版中，**有序**模式是默认模式。有序模式将元数据写入日志，但将数据直接提交至文件系统。顾名思义，这里的操作*顺序*是严格的：首先，将元数据提交给日记；然后，将元数据提交给日志。其次，将数据写入文件系统，然后日志中的关联元数据才刷新到文件系统本身。这样可以确保在发生崩溃的情况下，与未完成写入相关联的元数据仍保留在日志中，并且文件系统可以在回滚日志的同时清理那些未完成的写入。在有序模式下，崩溃可能会导致文件崩溃或在崩溃期间被主动写入的文件损坏，但是可以保证文件系统本身以及未被主动写入的文件是安全的。
> - **写回**是第三种也是最不安全的日记模式。在写回模式下（如有序模式），将记录元数据，但不记录数据。与有序模式不同，元数据和数据都可以按照为了获得最佳性能而有意义的任何顺序进行写入。这可以显着提高性能，但安全性要差得多。尽管写回模式仍然可以保证文件系统本身的安全性，但是在崩溃期间*或*崩溃之前写入的文件很容易丢失或损坏

&emsp;&emsp;向磁盘写入数据主要是将meta data（inode）和file data写入到磁盘，file data用内存中的page代表，即将inode和page写入到物理设备，最底层为文件系统相关的驱动接口，与具体的文件系统相关，log data则保存在磁盘上面，需要通过写入更新

&emsp;&emsp;writeback相关的标志

```C
/*
	I_DIRTY_SYNC		Inode为脏,但不是一定要写入
	I_DIRTY_DATASYNC	Inode中与数据相关的更改待处理，需要被写入
	I_DIRTY_PAGES		Inode的page脏, Inode本身可能是干净的
	I_DIRTY_TIME		Inode的时间戳为脏，有以上标志则此标志被清除
	I_SYNC				writeback运行标志
*/
```

&emsp;&emsp;kernel在/proc/sys/vm/中预留了一些可以调整脏数据回写的参数

**dirty_background_bytes：**后台内核线程执行的最低脏内存量

**dirty_background_ratio：**后台内核线程执行的可用内存页与脏页比例（与上面的参数只能二选一）

**dirty_bytes（vm_dirty_bytes）：**内核线程开始回写的脏内存量（最低两页8k，与dirty_ratio二选一）

**dirty_ratio（vm_dirty_ratio）：**内核线程开始回写的可用内存和脏内存比率

**dirty_expire_centisecs（dirty_expire_interval）：**定义脏数据何时足够旧，下一次唤醒内核线程被写入（百分之一秒）

**dirtytime_expire_seconds（dirtytime_expire_interval）：**定义dirty inode何时足够旧，可以由内核线程进行回写，用作唤醒dirtytime_writeback线程的间隔

**dirty_writeback_centisecs（dirty_writeback_interval）：**多久唤醒一次内核线程



#### 2.2 内核线程调度

&emsp;&emsp;writeback中的异步实现机制为work_struct加内核线程，当前版本由writeback内核线程和kworker线程实现异步，首先在初始化的时候会创建一个writeback内核线程，用于工作队列的函数处理，内存压力、定时回写和sync通过调用wakeup_flusher_threads来唤醒writeback线程，kworker线程负责执行内核工作队列，其中的work由wb_workfn处理，每次在kworker线程组中随机指定一个线程来完成，因为工作队列指定了ubound参数，也就是不绑定任何cpu。

&emsp;&emsp;首先，在空闲的情况下每次执行回写都会重新计算下一次回写的时间，其中还会进行一些阈值的判断，来决定是否进行background方式的回写，当有内存压力时则会进行多次异步方式的回写，并在应用程序申请内存时进行判断内存是否达到阈值，达到阈值就进行回写，执行系统调用sync会在5s的间隔中插入一次异步回写，并会执行多次同步回写。

&emsp;&emsp;使用的线程组为

```C
1 I root      08:54 ?        00:00:00 [kworker/u32:1-events_unbound]
1 I root      09:51 ?        00:00:00 [kworker/u32:2-flush-259:0]
1 I root      09:57 ?        00:00:00 [kworker/u32:0-events_power_efficient]
1 I root      10:05 ?        00:00:00 [kworker/u32:3]
```

&emsp;&emsp;在wb_workfn中会将新的work插入到work_queue，并根据是否延时执行将work状态标记为WORK_STRUCT_PENDING_BIT（等待执行）状态，内核线程不为空则唤醒kworker线程处理函数处理work。

&emsp;&emsp;异步实现主要是通过内核中的cmwq，建立一个全局的工作队列bdi_wq来将所有的work插入到此队列中，workqueue定义和实现接口

&emsp;&emsp;初始化过程，创建工作队列并绑定处理函数

```C
	/* 定义 */
	struct workqueue_struct *bdi_wq;
	/* 增加work */
	queue_delayed_work(bdi_wq, &wb->dwork, timeout);

static int __init default_bdi_init(void)
{
	int err;
	/* 分配内存 */
	bdi_wq = alloc_workqueue("writeback", WQ_MEM_RECLAIM | WQ_UNBOUND | WQ_SYSFS, 0);
	...
}

static int wb_init(struct bdi_writeback *wb, struct backing_dev_info *bdi,
		   gfp_t gfp)
{
	...  
	INIT_LIST_HEAD(&wb->work_list);
	INIT_DELAYED_WORK(&wb->dwork, wb_workfn); //wb_workfn为工作队列的处理函数
	wb->dirty_sleep = jiffies;
	...
}
```

```C
/* 
 *文件的时间戳，共有三个：ctime指inode上一次变动的时间，mtime指文件内容上一次变动的时间，atime指文件上一次打开的时间。
 * 由atime引起inode变脏，如果有其他回写则不会进行此回写，根据dirtytime_writeback_centisecs延时唤醒,12h一次 */
static DECLARE_DELAYED_WORK(dirtytime_work, wakeup_dirtytime_writeback);
static void wakeup_dirtytime_writeback(struct work_struct *w)
{
		list_for_each_entry_rcu(wb, &bdi->wb_list, bdi_node)
			if (!list_empty(&wb->b_dirty_time))
				wb_wakeup(wb);

	schedule_delayed_work(&dirtytime_work, dirtytime_expire_interval * HZ);
}

```

&emsp;&emsp;当调用唤醒writeback线程时主要是在线程池中找到一个可用的线程并通过调度安排一个待处理的work，将其置于WORK_BUSY_RUNNING

```C
static void wb_wakeup(struct bdi_writeback *wb)
{
	if (test_bit(WB_registered, &wb->state))
		mod_delayed_work(bdi_wq, &wb->dwork, 0);
}

bool mod_delayed_work_on(int cpu, struct workqueue_struct *wq,
			 struct delayed_work *dwork, unsigned long delay)
{
    /* 找到一个pending的work */
	do {
		ret = try_to_grab_pending(&dwork->work, true, &flags);
	} while (unlikely(ret == -EAGAIN));

    /* 修改work的timer */
	if (likely(ret >= 0)) {
		__queue_delayed_work(cpu, wq, dwork, delay);
		local_irq_restore(flags);
	}
    ...
}
```

&emsp;&emsp;数据结构访问关系

<img src="/home/jian/Documents/work/调研报告/structs.png" alt="structs" style="zoom:25%;" />



#### 2.3 定期回写

&emsp;&emsp;定期回写是指每隔一段时间就去唤醒writeback线程，唤醒线程的同时会触发绑定的工作队列处理函数--wb_workfn，函数栈为

```
  submit_bio
  ext4_writepages
  do_writepages
  __writeback_single_inode
  writeback_sb_inodes
  wb_writeback
  wb_workfn
```

```C
void wb_workfn(struct work_struct *work)
{
	...
	set_worker_desc("flush-%s", bdi_dev_name(wb->bdi));
	current->flags |= PF_SWAPWRITE;

	if (likely(!current_is_workqueue_rescuer() ||
		   !test_bit(WB_registered, &wb->state))) {
		/* 正常情况，直到work_list为空停止运行 */
		do {
			pages_written = wb_do_writeback(wb);
		} while (!list_empty(&wb->work_list));
	} else {
		/* 紧急情况 */
		pages_written = writeback_inodes_wb(wb, 1024,
						    WB_REASON_FORKER_THREAD);
	}

    /* work_list非空则再次唤醒执行 */
	if (!list_empty(&wb->work_list))
		wb_wakeup(wb);
    /* dirty inode在其他list中还有，设置延后唤醒，dirty_writeback_interval设置为500 */
	else if (wb_has_dirty_io(wb) && dirty_writeback_interval)
		wb_wakeup_delayed(wb);

	current->flags &= ~PF_SWAPWRITE;
}
```

```C
static long wb_do_writeback(struct bdi_writeback *wb)
{
    /* 如果设置了running标志则可以直接执行wb_writeback函数 */
	set_bit(WB_writeback_running, &wb->state);
	while ((work = get_next_work_item(wb)) != NULL) {
		wrote += wb_writeback(wb, work);
		finish_writeback_work(wb, work);
	}

	/* 检查start_all标志，判断是否需要进行全部回写 */
	wrote += wb_check_start_all(wb);

	/* 进行定期回写检查，检查间隔时间是否达到了5s，没有则直接返回，有则进行wb_writeback */
	wrote += wb_check_old_data_flush(wb);
    
    /* 进行后台检查，检查脏页数量是否超过了 dirty_background_bytes 或 dirty_background_ratio，
    超过了配置的参数则需要进行回写 */
    wrote += wb_check_background_flush(wb);
	clear_bit(WB_writeback_running, &wb->state);

	return wrote;
}
```

```C
static long wb_writeback(struct bdi_writeback *wb,
			 struct wb_writeback_work *work)
{
	...
	for (;;) {
		/* 脏页已被处理 */
		if (work->nr_pages <= 0)
			break;

		/* 后台回写和定期回写在work_list为空时可能永远运行，所以直接退出，以便这时其他的work能够被处理 */
		if ((work->for_background || work->for_kupdate) &&
		    !list_empty(&wb->work_list))
			break;

		/* 对于后台回写，低于dirty_background_ratio则不需要回写 */
		if (work->for_background && !wb_over_bg_thresh(wb))
			break;

		/* 后台回写和定期回写是特殊的，需要包含所有的inode节点 */
		if (work->for_kupdate) {
			dirtied_before = jiffies - msecs_to_jiffies(dirty_expire_interval * 10);
		} else if (work->for_background)
			dirtied_before = jiffies;

		if (list_empty(&wb->b_io))
			queue_io(wb, work, dirtied_before);
		if (work->sb)
			progress = writeback_sb_inodes(work->sb, wb, work);
		else
			progress = __writeback_inodes_wb(wb, work);

        /* 处理完毕 */
		if (progress)
			continue;

        /* b_more_io list也为空则说明全部处理完毕 */
		if (list_empty(&wb->b_more_io))
			break;
		/* 等待可用inode节点，否则忙碌 */
		trace_writeback_wait(wb, work);
		inode = wb_inode(wb->b_more_io.prev);
		/* 重新回到睡眠状态 */
		inode_sleep_on_writeback(inode);
	}

	return nr_pages - work->nr_pages;
}
```

```C
	struct writeback_control wbc = {
		.sync_mode		= work->sync_mode,
		.tagged_writepages	= work->tagged_writepages,
		.for_kupdate		= work->for_kupdate,
		.for_background		= work->for_background,
		.for_sync		= work->for_sync,
		.range_cyclic		= work->range_cyclic,
		.range_start		= 0,
		.range_end		= LLONG_MAX,
	};
```

```C
int dirty_writeback_centisecs_handler(struct ctl_table *table, int write,
		void *buffer, size_t *length, loff_t *ppos)
{
	unsigned int old_interval = dirty_writeback_interval;

	/* 前面通过遍历bdis和wbs的方式很麻烦，这里通过/proc文件系统进行定期唤醒 */
	if (!ret && write && dirty_writeback_interval &&
		dirty_writeback_interval != old_interval)
		wakeup_flusher_threads(WB_REASON_PERIODIC);
}
```

&emsp;&emsp;在writeback_sb_inodes函数中构建writeback_control结构用于将inode节点的脏page回写到block设备，处理完所有的dirty inode再重新通过wb_wakeup_delayed在5s之后唤醒，周而复始。

&emsp;&emsp;由以上的代码可知，定期回写采用cmwq，属于异步方式。



#### 2.4 系统调用回写

&emsp;&emsp;系统调用sync、fsync等也会触发回写：

* `sync( )`允许进程将所有脏缓冲区刷新到磁盘

* `fsync( )`允许进程将属于特定打开文件的所有块刷新到磁盘

* `fdatasync( )`与`fsync( )`相似，但只刷新data数据，不会刷新文件的inode块

&emsp;&emsp;sync系统调用栈为

```
  b'submit_bio'
  b'__block_write_full_page'
  b'block_write_full_page'
  b'blkdev_writepage'
  b'__writepage'
  b'write_cache_pages'
  b'generic_writepages'
  b'blkdev_writepages'
  b'do_writepages'
  b'__filemap_fdatawrite_range'
  b'filemap_fdatawrite'
  b'fdatawrite_one_bdev'
  b'iterate_bdevs'
  b'ksys_sync'
  b'__x64_sys_sync'
  b'do_syscall_64'
  b'entry_SYSCALL_64_after_hwframe'
    --
  b'[unknown]'
    b'sync'
```

&emsp;&emsp;在sync系统调用对应的ksys_sync处理函数中，第一步先是唤醒writeback线程，采用异步方式，异步方式与上面定期唤醒的方式类似，只是调用的接口不一样，这里唤醒的原因为WB_REASON_SYNC，之后在fdatawrite_one_bdev函数中把回写的请求提交到块io层

```C
void ksys_sync(void)
{
	int nowait = 0, wait = 1;

	wakeup_flusher_threads(WB_REASON_SYNC);
	iterate_supers(sync_inodes_one_sb, NULL);
	iterate_supers(sync_fs_one_sb, &nowait);
	iterate_supers(sync_fs_one_sb, &wait);
	iterate_bdevs(fdatawrite_one_bdev, NULL);
	iterate_bdevs(fdatawait_one_bdev, NULL);
	if (unlikely(laptop_mode))
		laptop_sync_completion();
}
```

&emsp;&emsp;唤醒线程打印信息如下，下面的为sync触发的（stackcount）

![Screenshot from 2021-03-30 09-22-23](/home/jian/Documents/work/调研报告/Screenshot from 2021-03-30 09-22-23.png)

&emsp;&emsp;这里在执行sync系统调用后，即执行了异步的唤醒，同时还直接调用了回写的接口，属于同步的方式，在抓取submit_bio时发现每次执行的次数是不确定的，原因就是因为采用循环等待的方式不停的去判断回写失败发生的时刻，当回写失败同时也意味着上一次的脏页全部回写完成

```C
int do_writepages(struct address_space *mapping, struct writeback_control *wbc)
{
	int ret;

	if (wbc->nr_to_write <= 0)
		return 0;
	while (1) {
		if (mapping->a_ops->writepages)
			ret = mapping->a_ops->writepages(mapping, wbc);
		else
			ret = generic_writepages(mapping, wbc);
		if ((ret != -ENOMEM) || (wbc->sync_mode != WB_SYNC_ALL))
			break;
		cond_resched();
		congestion_wait(BLK_RW_ASYNC, HZ/50);
	}
	return ret;
}
```



#### 2.5 内存压力回写

&emsp;&emsp;首先上述两种方式的回写中异步方式都会去调用wb_do_writeback这个函数，这个函数中的background方式的回写利用设置的dirty_background_ratio和dirty_background_bytes两个参数来检测脏页在可用内存中的比例和数量，定期回写5s检测一次，所以这里也会5s进行一次检测，异步方式，通过唤醒内核线程

```C
static long wb_check_background_flush(struct bdi_writeback *wb)
{
	if (wb_over_bg_thresh(wb)) { //检查当前脏页是否超过dirty_background_ratio参数
		struct wb_writeback_work work = {
			.nr_pages	= LONG_MAX,
			.sync_mode	= WB_SYNC_NONE,
			.for_background	= 1,
			.range_cyclic	= 1,
			.reason		= WB_REASON_BACKGROUND,
		};
		return wb_writeback(wb, &work);
	}
	return 0;
}
```

&emsp;&emsp;上面的方式属于被动调用，从而检查脏页所占内存，当内存不足时5s一次的检查肯定是不够的，这就需要另一种方式能够立即察觉到内存不足的情况并作出反映，就是在真正给应用程序分配物理页（缺页中断）时判断可用内存的状态，函数栈如下，属于同步方式

```
  b'domain_dirty_limits'
  b'balance_dirty_pages_ratelimited'
  b'fault_dirty_shared_page'
  b'do_wp_page'
  b'__handle_mm_fault'
  b'handle_mm_fault'
  b'do_user_addr_fault'
  b'exc_page_fault'
  b'asm_exc_page_fault'
    --
  b'[unknown]'
  b'[unknown]'
    b'systemd-journal' [362]
    1
```

&emsp;&emsp;其中主要函数是balance_dirty_pages_ratelimited，这里和上面background的方式类似，只是接口不一样，再向下调用balance_dirty_pages，最后都是调用domain_dirty_limits

```C
static void domain_dirty_limits(struct dirty_throttle_control *dtc)
{
	unsigned long bytes = vm_dirty_bytes;
	unsigned long bg_bytes = dirty_background_bytes;
	/* convert ratios to per-PAGE_SIZE for higher precision */
	unsigned long ratio = (vm_dirty_ratio * PAGE_SIZE) / 100;
	unsigned long bg_ratio = (dirty_background_ratio * PAGE_SIZE) / 100;
	unsigned long thresh;
	unsigned long bg_thresh;
	struct task_struct *tsk;

	/* gdtc is !NULL iff @dtc is for memcg domain */
	if (gdtc) {
		unsigned long global_avail = gdtc->avail;

		if (bytes)
			ratio = min(DIV_ROUND_UP(bytes, global_avail),
				    PAGE_SIZE);
		if (bg_bytes)
			bg_ratio = min(DIV_ROUND_UP(bg_bytes, global_avail),
				       PAGE_SIZE);
		bytes = bg_bytes = 0;
	}

    /* 计算ratio */
	if (bytes)
		thresh = DIV_ROUND_UP(bytes, PAGE_SIZE);
	else
		thresh = (ratio * available_memory) / PAGE_SIZE;

    /* 计算bg_ratio */
	if (bg_bytes)
		bg_thresh = DIV_ROUND_UP(bg_bytes, PAGE_SIZE);
	else
		bg_thresh = (bg_ratio * available_memory) / PAGE_SIZE;

    /* 更新数据 */
	if (bg_thresh >= thresh)
		bg_thresh = thresh / 2;
	tsk = current;
	if (rt_task(tsk)) {
		bg_thresh += bg_thresh / 4 + global_wb_domain.dirty_limit / 32;
		thresh += thresh / 4 + global_wb_domain.dirty_limit / 32;
	}
	dtc->thresh = thresh;
	dtc->bg_thresh = bg_thresh;
}
```

&emsp;&emsp;上面计算内存中的数据，每一次有进程将内存中的页弄脏都会调用一次，最后判断是否需要回写



#### 2.6 其他

&emsp;&emsp;从用户层来看，影响文件回写的因素与/proc/sys/vm/dirty*相关的参数相关

> 在未设置vm.dirty_background_bytes和vm.dirty_bytes前提下总结下dirty_background_ratio和dirty_ratio的作用就是:
>
> available_memory=NR_FREE_PAGES-dirty_balance_reserve+NR_INACTIVE_FILE+NR_ACTIVE_FILE-(min_free_kbytes/4)
>
> background_thresh=(dirty_background_ratio * available_memory) / 100=(vm.dirty_background_ratio*available_memory)/100
>
> dirty_thresh = (vm_dirty_ratio * available_memory) / 100 =(vm.dirty_ratio*available_memory)/100
>
> 
>
> dirty_background_ratio的值必须小于dirty_ratio，如果设置dirty_background_ratio大于或等于dirty_ratio时，最后生效的值实际上为:
>
> dirty_background_ratio=dirty_ratio/2. 之所以要保证dirty_ratio比dirty_background_ratio大的原因是为了避免因系统脏页数量小于background_thresh未唤醒后台进程回写脏数据，大于dirty_thresh导致应用进程因等待脏数据回写而进入IO阻塞状态。
>
> 根据上面的分析，可以总结出针对不同场景这些参数的调整策略：
>
> vm.dirty_background_ratio
>
> vm.dirty_ratio
>
> vm.dirty_expire_centisecs
>
> vm.dirty_writeback_centisecs
>
> 1. 追求[数据安全](https://cloud.tencent.com/solution/data_protection?from=10680)的场景适当调小这四个参数让脏数据尽快回刷磁盘;
>
> 2. 追求更高的性能而忽略丢数据风险则适当调大这些参数，增加内存缓存，减少IO操作;
>
> 3. 有不定时IO突增情况则适当调小dirty_background_ratio和增大dirty_ratio.
>
>
> 假设总内存为250G，IO带宽为100MB/s，那么理论上如果要尽可能确保所有脏数据在120s（hung_task_timeout_secs默认值）内全部落盘，dirty_background_ratio应该设置为多大？
>
> 按iostat监控到的带宽100MB/s计算
>
> 120s x 100MB/s = 12000MB=12GB
>
> 12GB/250G = 4.8%
>
> 4.8%取整相当于dirty_background_ratio的值要设置为4。带宽和总内存都不变的前提下，如果要确保dirty数据要全部在60s内落盘则将dirty_background_ratio设置为2.
>
> https://cloud.tencent.com/developer/article/1631974



**FAQ**

1.内核线程如何被调度去处理work

2.file data如何被修改，address_space与page的映射关系



