/* global artifacts */

const ethers = require("ethers");
const {
  deployMaker, deployUniswap, WAD, ETH_PER_DAI, ETH_PER_MKR,
} = require("../utils/defi-deployer");
const RelayManager = require("../utils/relay-manager");

const Registry = artifacts.require("ModuleRegistry");
const MakerV2Manager = artifacts.require("MakerV2Manager");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const GuardianStorage = artifacts.require("GuardianStorage");
const MakerRegistry = artifacts.require("MakerRegistry");
const RelayerModule = artifacts.require("RelayerModule");

const DAI_SENT = WAD.div(100000000);

contract("MakerV2Invest", (accounts) => {
  const manager = new RelayManager();
  const { deployer } = manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];

  let wallet;
  let walletImplementation;
  let relayerModule;
  let makerV2;
  let sai;
  let dai;

  before(async () => {
    const m = await deployMaker(deployer, infrastructure);
    [sai, dai] = [m.sai, m.dai];
    const {
      migration,
      pot,
      jug,
      vat,
      gov,
    } = m;

    const registry = await Registry.new();
    const guardianStorage = await GuardianStorage.new();

    const makerRegistry = await MakerRegistry.new(vat.address);

    // Deploy Uniswap
    const uni = await deployUniswap(deployer, manager, infrastructure, [gov, dai], [ETH_PER_MKR, ETH_PER_DAI]);

    makerV2 = await MakerV2Manager.new(
      registry.address,
      guardianStorage.address,
      migration.address,
      pot.address,
      jug.address,
      makerRegistry.address,
      uni.uniswapFactory.address,
    );

    walletImplementation = await BaseWallet.new();

    relayerModule = await RelayerModule.new(
      registry.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
    );
    manager.setRelayerModule(relayerModule);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);

    await wallet.init(owner, [makerV2.address, relayerModule.address]);
    await sai["mint(address,uint256)"](wallet.address, DAI_SENT.mul(20));
    await dai["mint(address,uint256)"](wallet.address, DAI_SENT.mul(20));
  });

  async function exchangeWithPot({ toPot, relayed, all = false }) {
    const walletBefore = (await dai.balanceOf(wallet.address)).add(await sai.balanceOf(wallet.address));
    const investedBefore = await makerV2.dsrBalance(wallet.address);
    let method;
    if (toPot) {
      method = "joinDsr";
    } else if (all) {
      method = "exitAllDsr";
    } else {
      method = "exitDsr";
    }
    const params = [wallet.address].concat(all ? [] : [DAI_SENT]);
    if (relayed) {
      await manager.relay(makerV2, method, params, wallet, [owner]);
    } else {
      await (await makerV2.from(owner)[method](...params, { gasLimit: 2000000 })).wait();
    }
    const walletAfter = (await dai.balanceOf(wallet.address)).add(await sai.balanceOf(wallet.address));
    const investedAfter = await makerV2.dsrBalance(wallet.address);
    const deltaInvested = toPot ? investedAfter.sub(investedBefore) : investedBefore.sub(investedAfter);
    const deltaWallet = toPot ? walletBefore.sub(walletAfter) : walletAfter.sub(walletBefore);
    assert.isTrue(deltaInvested.gt(0), "DAI in DSR should have changed.");
    assert.isTrue(deltaWallet.gt(0), "DAI in wallet should have changed.");

    if (all) {
      assert.isTrue(investedAfter.eq(0), "Pot should be emptied");
      assert.isTrue(walletAfter.gt(walletBefore), "DAI in wallet should have increased");
    }
  }

  describe("Deposit", () => {
    it("sends DAI to the pot (blockchain tx)", async () => {
      await exchangeWithPot({ toPot: true, relayed: false });
      // do it a second time, when Vat authorisations have already been granted
      await exchangeWithPot({ toPot: true, relayed: false });
    });

    it("sends DAI to the pot (relayed tx)", async () => {
      await exchangeWithPot({ toPot: true, relayed: true });
      // do it a second time, when Vat authorisations have already been granted
      await exchangeWithPot({ toPot: true, relayed: true });
    });
  });

  describe("Withdraw", () => {
    beforeEach(async () => {
      await exchangeWithPot({ toPot: true, relayed: false });
    });

    it("withdraw DAI from the pot (blockchain tx)", async () => {
      await exchangeWithPot({ toPot: false, relayed: false });
    });

    it("withdraw DAI from the pot (relayed tx)", async () => {
      await exchangeWithPot({ toPot: false, relayed: true });
    });

    it("withdraw ALL DAI from the pot (blockchain tx)", async () => {
      await exchangeWithPot({ toPot: false, relayed: false, all: true });
    });

    it("withdraw ALL DAI from the pot (relayed tx)", async () => {
      await exchangeWithPot({ toPot: false, relayed: true, all: true });
    });
  });
});
