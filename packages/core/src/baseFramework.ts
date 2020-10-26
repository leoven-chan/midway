import {
  IConfigurationOptions,
  IMidwayApplication,
  IMidwayBootstrapOptions,
  IMidwayContainer,
  IMidwayFramework,
  MidwayFrameworkType,
  MidwayProcessTypeEnum,
} from './interface';
import { MidwayContainer } from './context/midwayContainer';
import {
  APPLICATION_KEY,
  ASPECT_KEY,
  getClassMetadata,
  IMethodAspect,
  listModule,
  listPreloadModule
} from '@midwayjs/decorator';
import { isAbsolute, join } from 'path';

function buildLoadDir(baseDir, dir) {
  if (!isAbsolute(dir)) {
    return join(baseDir, dir);
  }
  return dir;
}

export abstract class BaseFramework<
  APP extends IMidwayApplication,
  T extends IConfigurationOptions
> implements IMidwayFramework<APP, T> {
  protected isTsMode = true;
  protected baseDir: string;
  protected appDir: string;
  protected applicationContext: IMidwayContainer;
  public configurationOptions: T;
  public app: APP;

  public configure(options: T): BaseFramework<APP, T> {
    this.configurationOptions = options;
    return this;
  }

  public async initialize(
    options: IMidwayBootstrapOptions
  ): Promise<void> {
    this.baseDir = options.baseDir;
    this.appDir = options.appDir;

    /**
     * before create MidwayContainer instance，can change init parameters
     */
    await this.beforeContainerInitialize(options);

    /**
     * initialize MidwayContainer instance
     */
    await this.containerInitialize(options);

    /**
     * before container load directory and bind
     */
    await this.afterContainerInitialize(options);

    /**
     * run container loadDirectoryLoad method to create object definition
     */
    await this.containerDirectoryLoad(options);

    /**
     * after container load directory and bind
     */
    await this.afterContainerDirectoryLoad(options);

    /**
     * Third party application initialization
     */
    await this.applicationInitialize(options);

    /**
     * start to load configuration and lifeCycle
     */
    await this.containerReady(options);

    /**
     * after container refresh
     */
    await this.afterContainerReady(options);
  }

  protected async containerInitialize(options: IMidwayBootstrapOptions) {
    this.applicationContext = new MidwayContainer(this.baseDir, undefined);
    this.applicationContext.disableConflictCheck = options.disableConflictCheck;
    this.applicationContext.registerObject('baseDir', this.baseDir);
    this.applicationContext.registerObject('appDir', this.appDir);
    this.applicationContext.registerObject('isTsMode', this.isTsMode);
  }

  protected async containerDirectoryLoad(options: IMidwayBootstrapOptions) {
    /**
     * load directory and bind files to ioc container
     */
    if (!this.isTsMode && options.disableAutoLoad === undefined) {
      // disable auto load in js mode by default
      options.disableAutoLoad = true;
    }

    if (options.disableAutoLoad) return;

    // use baseDir in parameter first
    const baseDir = options.baseDir || this.baseDir;
    const defaultLoadDir = this.isTsMode ? [baseDir] : [];
    this.applicationContext.load({
      loadDir: (options.loadDir || defaultLoadDir).map(dir => {
        return buildLoadDir(baseDir, dir);
      }),
      pattern: options.pattern,
      ignore: options.ignore,
    });

    if (options.preloadModules && options.preloadModules.length) {
      for (const preloadModule of options.preloadModules) {
        this.applicationContext.bindClass(preloadModule);
      }
    }

    this.applicationContext.registerDataHandler(APPLICATION_KEY, () => {
      return this.getApplication();
    });
  }

  protected async containerReady(options: IMidwayBootstrapOptions) {
    if (!this.app.getApplicationContext) {
      this.defineApplicationProperties();
    }

    await this.applicationContext.ready();

    // some common decorator implementation
    const modules = listPreloadModule();
    for (const module of modules) {
      // preload init context
      await this.getApplicationContext().getAsync(module);
    }

    // for aop implementation
    const aspectModules = listModule(ASPECT_KEY);
    // sort for aspect target
    let aspectDataList = [];
    for (const module of aspectModules) {
      const data = getClassMetadata(ASPECT_KEY, module);
      aspectDataList = aspectDataList.concat(
        data.map(el => {
          el.aspectModule = module;
          return el;
        })
      );
    }

    // sort priority
    aspectDataList.sort((pre, next) => {
      return (next.priority || 0) - (pre.priority || 0);
    });

    for (const aspectData of aspectDataList) {
      const aspectIns = await this.getApplicationContext().getAsync<
        IMethodAspect
        >(aspectData.aspectModule);
      await this.getApplicationContext().addAspect(aspectIns, aspectData);
    }
  }

  protected async containerStop() {
    await this.applicationContext.stop();
  }

  public getApplicationContext(): IMidwayContainer {
    return this.applicationContext;
  }

  public getConfiguration(key?: string): any {
    return this.getApplicationContext()
      .getConfigService()
      .getConfiguration(key);
  }

  public getCurrentEnvironment() {
    return this.getApplicationContext()
      .getEnvironmentService()
      .getCurrentEnvironment();
  }

  public abstract async applicationInitialize(options: IMidwayBootstrapOptions);

  public abstract getFrameworkType(): MidwayFrameworkType;

  public abstract getApplication(): APP;

  public abstract run(): Promise<void>;

  public async stop(): Promise<void> {
    await this.beforeStop();
    await this.containerStop();
  }

  protected defineApplicationProperties(applicationProperties: object = {}) {
    const defaultApplicationProperties = {
      getBaseDir: () => {
        return this.baseDir;
      },

      getAppDir: () => {
        return this.appDir;
      },

      getEnv: () => {
        return this.getApplicationContext()
          .getEnvironmentService()
          .getCurrentEnvironment();
      },

      getApplicationContext: () => {
        return this.getApplicationContext();
      },

      getConfig: (key?: string) => {
        return this.getApplicationContext()
          .getConfigService()
          .getConfiguration(key);
      },

      getFrameworkType: () => {
        return this.getFrameworkType();
      },

      getProcessType: () => {
        return MidwayProcessTypeEnum.APPLICATION;
      },
    };
    Object.assign(
      this.app,
      defaultApplicationProperties,
      applicationProperties
    );
  }

  protected async beforeStop(): Promise<void> {}

  protected async beforeContainerInitialize(
    options: Partial<IMidwayBootstrapOptions>
  ): Promise<void> {}

  protected async afterContainerInitialize(
    options: Partial<IMidwayBootstrapOptions>
  ): Promise<void> {}

  protected async afterContainerDirectoryLoad(
    options: Partial<IMidwayBootstrapOptions>
  ): Promise<void> {}

  protected async afterContainerReady(
    options: Partial<IMidwayBootstrapOptions>
  ): Promise<void> {}
}