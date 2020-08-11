/* global artifacts */
const ethers = require("ethers");
const BN = require("bn.js");
const { formatBytes32String } = require("ethers").utils;
const { parseRelayReceipt, hasEvent } = require("../utils/utilities.js");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const BadModule = artifacts.require("BadModule");
const RelayerModule = artifacts.require("RelayerModule");
const TestModule = artifacts.require("TestModule");
const TestLimitModule = artifacts.require("TestLimitModule");
const TestOnlyOwnerModule = artifacts.require("TestOnlyOwnerModule");
const Registry = artifacts.require("ModuleRegistry");
const GuardianManager = artifacts.require("GuardianManager");
const GuardianStorage = artifacts.require("GuardianStorage");
const LimitStorage = artifacts.require("LimitStorage");
const TokenPriceStorage = artifacts.require("TokenPriceStorage");
const ApprovedTransfer = artifacts.require("ApprovedTransfer");
const RecoveryManager = artifacts.require("RecoveryManager"); // non-owner only module
const ERC20 = artifacts.require("TestERC20");

const TestManager = require("../utils/test-manager");
const { ETH_TOKEN } = require("../utils/utilities.js");

const MODULE_NOT_AUTHORISED_FOR_WALLET = "RM: module not authorised";
const INVALID_DATA_REVERT_MSG = "RM: Invalid dataWallet";
const DUPLICATE_REQUEST_REVERT_MSG = "RM: Duplicate request";
const INVALID_WALLET_REVERT_MSG = "RM: Target of _data != _wallet";
const RELAYER_NOT_AUTHORISED_FOR_WALLET = "BM: must be owner or module";
const GAS_LESS_THAN_GASLIMIT = "RM: not enough gas provided";
const WRONG_NUMBER_SIGNATURES = "RM: Wrong number of signatures";

contract("RelayerModule", (accounts) => {
  const manager = new TestManager();
  const { deployer } = manager;
  let { getNonceForRelay } = manager;
  getNonceForRelay = getNonceForRelay.bind(manager);

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const recipient = accounts[3];
  const guardian = accounts[4];

  let registry;
  let guardianStorage;
  let limitStorage;
  let guardianManager;
  let recoveryManager;
  let wallet;
  let approvedTransfer;
  let testModule;
  let testModuleNew;
  let testOnlyOwnerModule;
  let relayerModule;
  let tokenPriceStorage;
  let limitModule;
  let badModule;

  before(async () => {
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    limitStorage = await deployer.deploy(LimitStorage);
    tokenPriceStorage = await deployer.deploy(TokenPriceStorage);
    await tokenPriceStorage.addManager(infrastructure);
    relayerModule = await deployer.deploy(RelayerModule, {},
      registry.contractAddress, guardianStorage.contractAddress, limitStorage.contractAddress, tokenPriceStorage.contractAddress);
    manager.setRelayerModule(relayerModule);
  });

  beforeEach(async () => {
    approvedTransfer = await deployer.deploy(ApprovedTransfer, {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      limitStorage.contractAddress,
      ethers.constants.AddressZero);
    guardianManager = await deployer.deploy(GuardianManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24, 12);
    recoveryManager = await deployer.deploy(RecoveryManager, {}, registry.contractAddress, guardianStorage.contractAddress, 36, 120);

    testModule = await deployer.deploy(TestModule, {}, registry.contractAddress, guardianStorage.contractAddress, false, 0);
    testModuleNew = await deployer.deploy(TestModule, {}, registry.contractAddress, guardianStorage.contractAddress, false, 0);
    testOnlyOwnerModule = await deployer.deploy(TestOnlyOwnerModule, {}, registry.contractAddress, guardianStorage.contractAddress);
    limitModule = await deployer.deploy(TestLimitModule, {}, registry.contractAddress, guardianStorage.contractAddress, limitStorage.contractAddress);
    badModule = await deployer.deploy(BadModule, {}, registry.contractAddress, guardianStorage.contractAddress);

    const walletImplementation = await deployer.deploy(BaseWallet);
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);

    await wallet.init(owner,
      [relayerModule.contractAddress,
        approvedTransfer.contractAddress,
        guardianManager.contractAddress,
        recoveryManager.contractAddress,
        testModule.contractAddress,
        limitModule.contractAddress,
        testOnlyOwnerModule.contractAddress,
        badModule.contractAddress]);
  });

  describe("relaying module transactions", () => {
    it("should fail when _data is less than 36 bytes", async () => {
      const params = []; // the first argument is not the wallet address, which should make the relaying revert
      await assert.revertWith(
        manager.relay(testModule, "clearInt", params, wallet, [owner]), INVALID_DATA_REVERT_MSG,
      );
    });

    it("should fail when module is not authorised", async () => {
      const params = [wallet.contractAddress, 2];
      await assert.revertWith(
        manager.relay(testModuleNew, "setIntOwnerOnly", params, wallet, [owner]), MODULE_NOT_AUTHORISED_FOR_WALLET,
      );
    });

    it("should fail when the RelayerModule is not authorised", async () => {
      const wrongWallet = await deployer.deploy(BaseWallet);
      await wrongWallet.init(owner, [testModule.contractAddress]);
      const params = [wrongWallet.contractAddress, 2];
      const txReceipt = await manager.relay(testModule, "setIntOwnerOnly", params, wrongWallet, [owner]);
      const { success, error } = parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, RELAYER_NOT_AUTHORISED_FOR_WALLET);
    });

    it("should fail when the first param is not the wallet ", async () => {
      const params = [owner, 4];
      await assert.revertWith(
        manager.relay(testModule, "setIntOwnerOnly", params, wallet, [owner]), INVALID_WALLET_REVERT_MSG,
      );
    });

    it("should fail when the gas of the transaction is less then the gasLimit ", async () => {
      const params = [wallet.contractAddress, 2];
      const nonce = await getNonceForRelay();
      const gasLimit = 2000000;
      const relayParams = [
        testModule,
        "setIntOwnerOnly",
        params,
        wallet,
        [owner],
        accounts[9],
        false,
        gasLimit,
        nonce,
        0,
        ETH_TOKEN,
        ethers.constants.AddressZero,
        gasLimit * 0.9];
      await assert.revertWith(manager.relay(...relayParams), GAS_LESS_THAN_GASLIMIT);
    });

    it("should fail when a wrong number of signatures is provided", async () => {
      const params = [wallet.contractAddress, 2];
      const relayParams = [testModule, "setIntOwnerOnly", params, wallet, [owner, recipient]];
      await assert.revertWith(manager.relay(...relayParams), WRONG_NUMBER_SIGNATURES);
    });

    it("should fail a duplicate transaction", async () => {
      const params = [wallet.contractAddress, 2];
      const nonce = await getNonceForRelay();
      const relayParams = [testModule, "setIntOwnerOnly", params, wallet, [owner],
        accounts[9], false, 2000000, nonce];
      await manager.relay(...relayParams);
      await assert.revertWith(
        manager.relay(...relayParams), DUPLICATE_REQUEST_REVERT_MSG,
      );
    });

    it("should fail when relaying to itself", async () => {
      const dataMethod = "setIntOwnerOnly";
      const dataParam = [wallet.contractAddress, 2];
      const methodData = testModule.contract.interface.functions[dataMethod].encode(dataParam);
      const params = [
        wallet.contractAddress,
        testModule.contractAddress,
        methodData,
        0,
        ethers.constants.HashZero,
        0,
        200000,
        ETH_TOKEN,
        ethers.constants.AddressZero,
      ];
      await assert.revertWith(
        manager.relay(relayerModule, "execute", params, wallet, [owner]), "BM: disabled method",
      );
    });

    it("should update the nonce after the transaction", async () => {
      const nonce = await getNonceForRelay();
      await manager.relay(testModule, "setIntOwnerOnly", [wallet.contractAddress, 2], wallet, [owner],
        accounts[9], false, 2000000, nonce);

      const updatedNonce = await relayerModule.getNonce(wallet.contractAddress);
      const updatedNonceHex = await ethers.utils.hexZeroPad(updatedNonce.toHexString(), 32);
      assert.equal(nonce, updatedNonceHex);
    });
  });

  describe("refund", () => {
    let erc20;
    beforeEach(async () => {
      const decimals = 12; // number of decimal for TOKN contract
      const tokenRate = new BN(10).pow(new BN(19)).muln(51); // 1 TOKN = 0.00051 ETH = 0.00051*10^18 ETH wei => *10^(18-decimals) = 0.00051*10^18 * 10^6 = 0.00051*10^24 = 51*10^19
      erc20 = await deployer.deploy(ERC20, {}, [infrastructure], 10000000, decimals); // TOKN contract with 10M tokens (10M TOKN for account[0])
      await tokenPriceStorage.setPrice(erc20.contractAddress, tokenRate.toString());
      await limitModule.setLimitAndDailySpent(wallet.contractAddress, 10000000000, 0);
    });

    async function provisionFunds(ethAmount, erc20Amount) {
      if (ethAmount) {
        await wallet.send(ethAmount);
      }
      if (erc20Amount) {
        await erc20.transfer(wallet.contractAddress, erc20Amount);
      }
    }

    async function callAndRefund({ refundToken }) {
      const nonce = await getNonceForRelay();
      const relayParams = [
        testModule,
        "setIntOwnerOnly",
        [wallet.contractAddress, 2],
        wallet,
        [owner],
        accounts[9],
        false,
        2000000,
        nonce,
        10,
        refundToken,
        recipient];
      const txReceipt = await manager.relay(...relayParams);
      return txReceipt;
    }

    async function setLimitAndDailySpent({ limit, alreadySpent }) {
      await limitModule.setLimitAndDailySpent(wallet.contractAddress, limit, alreadySpent);
    }

    it("should refund in ETH", async () => {
      await provisionFunds(ethers.BigNumber.from("100000000000000"), 0);
      const wBalanceStart = await deployer.provider.getBalance(wallet.contractAddress);
      const rBalanceStart = await deployer.provider.getBalance(recipient);
      await callAndRefund({ refundToken: ETH_TOKEN });
      const wBalanceEnd = await deployer.provider.getBalance(wallet.contractAddress);
      const rBalanceEnd = await deployer.provider.getBalance(recipient);
      const refund = wBalanceStart.sub(wBalanceEnd);
      assert.isTrue(refund.gt(0), "should have refunded ETH");
      assert.isTrue(refund.eq(rBalanceEnd.sub(rBalanceStart)), "should have refunded the recipient");
    });

    it("should refund in ERC20", async () => {
      await provisionFunds(0, ethers.BigNumber.from("100000000000000"));
      const wBalanceStart = await erc20.balanceOf(wallet.contractAddress);
      const rBalanceStart = await erc20.balanceOf(recipient);
      await callAndRefund({ refundToken: erc20.contractAddress });
      const wBalanceEnd = await erc20.balanceOf(wallet.contractAddress);
      const rBalanceEnd = await erc20.balanceOf(recipient);
      const refund = wBalanceStart.sub(wBalanceEnd);
      assert.isTrue(refund.gt(0), "should have refunded ERC20");
      assert.isTrue(refund.eq(rBalanceEnd.sub(rBalanceStart)), "should have refunded the recipient");
    });

    it("should emit the Refund event", async () => {
      await provisionFunds(ethers.BigNumber.from("100000000000"), 0);
      const txReceipt = await callAndRefund({ refundToken: ETH_TOKEN });
      assert.isTrue(await hasEvent(txReceipt, relayerModule, "Refund"), "should have generated Refund event");
    });

    it("should fail the transaction when when there is not enough ETH for the refund", async () => {
      await provisionFunds(ethers.BigNumber.from("10"), 0);
      await assert.revertWith(callAndRefund({ refundToken: ETH_TOKEN }), "BM: wallet invoke reverted");
    });

    it("should fail the transaction when when there is not enough ERC20 for the refund", async () => {
      await provisionFunds(0, ethers.BigNumber.from("10"));
      await assert.revertWith(callAndRefund({ refundToken: erc20.contractAddress }), "ERC20: transfer amount exceeds balance");
    });

    it("should include the refund in the daily limit", async () => {
      await provisionFunds(ethers.BigNumber.from("100000000000"), 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 10 });
      let dailySpent = await limitModule.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent.toNumber() === 10, "initial daily spent should be 10");
      await callAndRefund({ refundToken: ETH_TOKEN });
      dailySpent = await limitModule.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent > 10, "Daily spent should be greater then 10");
    });

    it("should refund and reset the daily limit when approved by guardians", async () => {
      // set funds and limit/daily spent
      await provisionFunds(ethers.BigNumber.from("100000000000"), 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 10 });
      let dailySpent = await limitModule.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent.toNumber() === 10, "initial daily spent should be 10");
      const rBalanceStart = await deployer.provider.getBalance(recipient);
      // add a guardian
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian);
      // call approvedTransfer
      const params = [wallet.contractAddress, ETH_TOKEN, recipient, 1000, ethers.constants.HashZero];
      const nonce = await getNonceForRelay();
      const gasLimit = 2000000;
      const relayParams = [
        approvedTransfer,
        "transferToken",
        params,
        wallet,
        [owner, guardian],
        accounts[9],
        false,
        gasLimit,
        nonce,
        0,
        ETH_TOKEN,
        ethers.constants.AddressZero,
        gasLimit * 1.1];
      await manager.relay(...relayParams);
      dailySpent = await limitModule.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent.toNumber() === 0, "daily spent should be reset");
      const rBalanceEnd = await deployer.provider.getBalance(recipient);
      assert.isTrue(rBalanceEnd.gt(rBalanceStart), "should have refunded the recipient");
    });

    it("should fail if required signatures is 0 and OwnerRequirement is not Anyone", async () => {
      await assert.revertWith(
        manager.relay(badModule, "setIntOwnerOnly", [wallet.contractAddress, 2], wallet, [owner]), "RM: Wrong signature requirement",
      );
    });

    it("should fail the transaction when the refund is over the daily limit", async () => {
      await provisionFunds(ethers.BigNumber.from("100000000000"), 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 999999990 });
      const dailySpent = await limitModule.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent.toNumber() === 999999990, "initial daily spent should be 999999990");
      await assert.revertWith(callAndRefund({ refundToken: ETH_TOKEN }), "RM: refund is above daily limit");
    });
  });

  describe("addModule transactions", () => {
    it("should succeed when relayed on OnlyOwnerModule modules", async () => {
      await registry.registerModule(testModuleNew.contractAddress, formatBytes32String("testModuleNew"));
      const params = [wallet.contractAddress, testModuleNew.contractAddress];
      await manager.relay(testOnlyOwnerModule, "addModule", params, wallet, [owner]);

      const isModuleAuthorised = await wallet.authorised(testModuleNew.contractAddress);
      assert.isTrue(isModuleAuthorised);
    });

    it("should succeed when called directly on OnlyOwnerModule modules", async () => {
      await registry.registerModule(testModuleNew.contractAddress, formatBytes32String("testModuleNew"));
      await testOnlyOwnerModule.from(owner).addModule(wallet.contractAddress, testModuleNew.contractAddress);

      const isModuleAuthorised = await wallet.authorised(testModuleNew.contractAddress);
      assert.isTrue(isModuleAuthorised);
    });

    it("should fail when relayed on non-OnlyOwnerModule modules", async () => {
      await registry.registerModule(testModuleNew.contractAddress, formatBytes32String("testModuleNew"));
      const params = [wallet.contractAddress, testModuleNew.contractAddress];
      const txReceipt = await manager.relay(approvedTransfer, "addModule", params, wallet, [owner]);
      const { success, error } = parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "BM: must be wallet owner");

      const isModuleAuthorised = await wallet.authorised(testModuleNew.contractAddress);
      assert.isFalse(isModuleAuthorised);
    });

    it("should succeed when called directly on non-OnlyOwnerModule modules", async () => {
      await registry.registerModule(testModuleNew.contractAddress, formatBytes32String("testModuleNew"));
      await approvedTransfer.from(owner).addModule(wallet.contractAddress, testModuleNew.contractAddress);
      const isModuleAuthorised = await wallet.authorised(testModuleNew.contractAddress);
      assert.isTrue(isModuleAuthorised);
    });

    it("should fail to add module which is not registered", async () => {
      await assert.revertWith(approvedTransfer.from(owner).addModule(wallet.contractAddress, testModuleNew.contractAddress),
        "BM: module is not registered");
    });
  });
});
