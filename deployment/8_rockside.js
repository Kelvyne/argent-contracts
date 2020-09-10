const RocksideModule = require("../build-legacy/v1.6.0/RocksideModule");

const BaseWallet = require("../build/BaseWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const CompoundRegistry = require("../build/CompoundRegistry");
const MultiSig = require("../build/MultiSigWallet");
const ENS = require("../build/ENSRegistryWithFallback");
const ENSManager = require("../build/ArgentENSManager");
const ENSResolver = require("../build/ArgentENSResolver");
const WalletFactory = require("../build-legacy/v1.6.0/WalletFactory");
const TokenPriceProvider = require("../build-legacy/v1.6.0/TokenPriceProvider");
const MakerRegistry = require("../build/MakerRegistry");
const ScdMcdMigration = require("../build/ScdMcdMigration");

const utils = require("../utils/utilities.js");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const deploy = async (network) => {
  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const manager = new DeployManager(network);
  await manager.setup();

  const { configurator } = manager;
  const { deployer } = manager;

  const prevConfig = configurator.copyConfig();
  console.log("Previous Config:", prevConfig);

  // //////////////////////////////////
  // Deploy contracts
  // //////////////////////////////////

  const RocksideModuleWrapper = await deployer.deploy(
    RocksideModule,
    {},
    prevConfig.contracts.ModuleRegistry,
    prevConfig.modules.GuardianStorage,
  );

  console.log(RocksideModuleWrapper.contractAddress);

  await configurator.save();
};

module.exports = {
  deploy,
};
