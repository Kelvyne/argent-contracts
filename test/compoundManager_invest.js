/* global artifacts */
const { parseEther, formatBytes32String } = require("ethers").utils;
const ethers = require("ethers");
const utils = require("../utils/utilities.js");

const GuardianStorage = artifacts.require("GuardianStorage");
const Registry = artifacts.require("ModuleRegistry");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const RelayerModule = artifacts.require("RelayerModule");
const CompoundManager = artifacts.require("CompoundManager");

// Compound
const Unitroller = artifacts.require("Unitroller");
const PriceOracle = artifacts.require("SimplePriceOracle");
const PriceOracleProxy = artifacts.require("PriceOracleProxy");
const Comptroller = artifacts.require("Comptroller");
const InterestModel = artifacts.require("WhitePaperInterestRateModel");
const CEther = artifacts.require("CEther");
const CErc20 = artifacts.require("CErc20");
const CompoundRegistry = artifacts.require("CompoundRegistry");

const WAD = ethers.BigNumber.from("1000000000000000000"); // 10**18
const ETH_EXCHANGE_RATE = ethers.BigNumber.from("200000000000000000000000000");

const ERC20 = artifacts.require("TestERC20");

const { ETH_TOKEN, increaseTime } = require("../utils/utilities.js");
const RelayManager = require("../utils/relay-manager");

contract("Invest Manager with Compound", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const liquidityProvider = accounts[2];
  const borrower = accounts[3];

  let wallet;
  let walletImplementation;
  let registry;
  let investManager;
  let relayerModule;
  let compoundRegistry;
  let token;
  let cToken;
  let cEther;
  let comptroller;
  let oracleProxy;

  before(async () => {
    /* Deploy Compound V2 Architecture */

    // deploy price oracle
    const oracle = await PriceOracle.new();

    // deploy comptroller
    const comptrollerProxy = await Unitroller.new();
    const comptrollerImpl = await Comptroller.new();
    await comptrollerProxy._setPendingImplementation(comptrollerImpl.address);
    await comptrollerImpl._become(comptrollerProxy.address, oracle.address, WAD.div(10), 5, false);
    comptroller = Comptroller.at(comptrollerProxy.address);
    // deploy Interest rate model
    const interestModel = await InterestModel.new(WAD.mul(250).div(10000), WAD.mul(2000).div(10000));
    // deploy CEther
    cEther = await CEther.new(
      comptroller.address,
      interestModel.address,
      ETH_EXCHANGE_RATE,
      formatBytes32String("Compound Ether"),
      formatBytes32String("cETH"),
      8,
    );

    // deploy token
    token = await ERC20.new([infrastructure, liquidityProvider, borrower], 10000000, 18);
    // deploy CToken
    cToken = await CErc20.new(
      token.address,
      comptroller.address,
      interestModel.address,
      ETH_EXCHANGE_RATE,
      "Compound Token",
      "cTOKEN",
      18,
    );
    // add price to Oracle
    await oracle.setUnderlyingPrice(cToken.address, WAD.div(10));
    // list cToken in Comptroller
    await comptroller._supportMarket(cEther.address);
    await comptroller._supportMarket(cToken.address);
    // deploy Price Oracle proxy
    oracleProxy = await PriceOracleProxy.new(comptroller.address, oracle.address, cEther.address);
    await comptroller._setPriceOracle(oracleProxy.address);
    // set collateral factor
    await comptroller._setCollateralFactor(cToken.address, WAD.div(10));
    await comptroller._setCollateralFactor(cEther.address, WAD.div(10));

    // add liquidity to tokens
    await cEther.mint({ value: parseEther("100"), from: liquidityProvider });
    await token.approve(cToken.address, parseEther("100"), { from: liquidityProvider });
    await cToken.mint(parseEther("10"), { from: liquidityProvider });

    /* Deploy Argent Architecture */

    compoundRegistry = await CompoundRegistry.new();
    await compoundRegistry.addCToken(ETH_TOKEN, cEther.address);
    await compoundRegistry.addCToken(token.address, cToken.address);
    registry = await Registry.new();
    const guardianStorage = await GuardianStorage.new();
    investManager = await CompoundManager.new(
      registry.address,
      guardianStorage.address,
      comptroller.address,
      compoundRegistry.address,
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
    await wallet.init(owner, [investManager.address, relayerModule.address]);
  });

  describe("Environment", () => {
    it("should deploy the environment correctly", async () => {
      const getCToken = await compoundRegistry.getCToken(token.address);
      assert.isTrue(getCToken === cToken.address, "cToken should be registered");
      const getCEther = await compoundRegistry.getCToken(ETH_TOKEN);
      assert.isTrue(getCEther === cEther.address, "cEther should be registered");
      const cOracle = await comptroller.oracle();
      assert.isTrue(cOracle === oracleProxy.address, "oracle should be registered");
      const cTokenPrice = await oracleProxy.getUnderlyingPrice(cToken.address);
      assert.isTrue(cTokenPrice.eq(WAD.div(10)), "cToken price should be 1e17");
      const cEtherPrice = await oracleProxy.getUnderlyingPrice(cEther.address);
      assert.isTrue(cEtherPrice.eq(WAD), "cEther price should be 1e18");
    });
  });

  describe("Investment", () => {
    async function accrueInterests(days, investInEth) {
      let tx; let
        txReceipt;
      // genrate borrows to create interests
      await comptroller.enterMarkets([cEther.address, cToken.address], { from: borrower });
      if (investInEth) {
        await token.approve(cToken.address, parseEther("20"), { from: borrower });
        await cToken.mint(parseEther("20"), { from: borrower });
        tx = await cEther.borrow(parseEther("0.1"), { from: borrower });
        txReceipt = await cEther.verboseWaitForTransaction(tx);
        assert.isTrue(await utils.hasEvent(txReceipt, cEther, "Borrow"), "should have generated Borrow event");
      } else {
        await cEther.mint({ value: parseEther("2"), from: borrower });
        tx = await cToken.borrow(parseEther("0.1"), { from: borrower });
        txReceipt = await cToken.verboseWaitForTransaction(tx);
        assert.isTrue(await utils.hasEvent(txReceipt, cToken, "Borrow"), "should have generated Borrow event");
      }
      // increase time to accumulate interests
      await increaseTime(3600 * 24 * days);
      await cToken.accrueInterest();
      await cEther.accrueInterest();
    }

    async function addInvestment(tokenAddress, amount, days, relay = false) {
      let tx;
      let txReceipt;
      const investInEth = (tokenAddress === ETH_TOKEN);

      if (investInEth) {
        tx = await wallet.send(amount);
      } else {
        await token.transfer(wallet.address, amount);
      }
      const params = [wallet.address, tokenAddress, amount, 0];
      if (relay) {
        txReceipt = await manager.relay(investManager, "addInvestment", params, wallet, [owner]);
      } else {
        tx = await investManager.addInvestment(...params, { from: owner });
        txReceipt = await investManager.verboseWaitForTransaction(tx);
      }

      assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentAdded"), "should have generated InvestmentAdded event");

      await accrueInterests(days, investInEth);

      const output = await investManager.getInvestment(wallet.address, tokenAddress);
      assert.isTrue(output._tokenValue > amount, "investment should have gained value");

      return output._tokenValue;
    }

    async function removeInvestment(tokenAddress, fraction, relay = false) {
      let tx; let
        txReceipt;
      const investInEth = (tokenAddress === ETH_TOKEN);

      await addInvestment(tokenAddress, parseEther("0.1"), 365, false);
      const before = investInEth ? await cEther.balanceOf(wallet.address) : await cToken.balanceOf(wallet.address);

      const params = [wallet.address, tokenAddress, fraction];
      if (relay) {
        txReceipt = await manager.relay(investManager, "removeInvestment", params, wallet, [owner]);
      } else {
        tx = await investManager.removeInvestment(...params, { from: owner });
        txReceipt = await investManager.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentRemoved"), "should have generated InvestmentRemoved event");

      const after = investInEth ? await cEther.balanceOf(wallet.address) : await cToken.balanceOf(wallet.address);
      assert.isTrue(after.eq(Math.ceil((before * (10000 - fraction)) / 10000)), "should have removed the correct fraction");
    }

    describe("Add Investment", () => {
      // Successes

      it("should invest in ERC20 for 1 year and gain interests (blockchain tx)", async () => {
        await addInvestment(token.address, parseEther("1"), 365, false);
      });

      it("should invest in ERC20 for 1 year and gain interests (relay tx)", async () => {
        await addInvestment(token.address, parseEther("1"), 365, true);
      });

      it("should invest in ETH for 1 year and gain interests (blockchain tx)", async () => {
        await addInvestment(ETH_TOKEN, parseEther("1"), 365, false);
      });

      it("should invest in ETH for 1 year and gain interests (relay tx)", async () => {
        await addInvestment(ETH_TOKEN, parseEther("1"), 365, true);
      });

      // Reverts

      it("should fail to invest in ERC20 with an unknown token", async () => {
        const params = [wallet.address, ethers.constants.AddressZero, parseEther("1"), 0];
        await utils.assertRevert(investManager.addInvestment(...params, { from: owner }), "CM: No market for target token");
      });

      it("should fail to invest in ERC20 with an amount of zero", async () => {
        const params = [wallet.address, token.address, 0, 0];
        await utils.assertRevert(investManager.addInvestment(...params, { from: owner }), "CM: amount cannot be 0");
      });

      it("should fail to invest in ERC20 when not holding any ERC20", async () => {
        const params = [wallet.address, token.address, parseEther("1"), 0];
        await utils.assertRevert(investManager.addInvestment(...params, { from: owner }), "CM: mint failed");
      });
    });

    describe("Remove Investment", () => {
      // Successes

      function testRemoveERC20Investment(fraction, relay) {
        it(`should remove ${fraction / 100}% of an ERC20 investment (${relay ? "relay" : "blockchain"} tx)`, async () => {
          await removeInvestment(token.address, fraction, relay);
        });
      }
      function testRemoveETHInvestment(fraction, relay) {
        it(`should remove ${fraction / 100}% of an ETH investment (${relay ? "relay" : "blockchain"} tx)`, async () => {
          await removeInvestment(token.address, fraction, relay);
        });
      }

      for (let i = 1; i < 6; i += 1) {
        testRemoveERC20Investment(i * 2000, true);
        testRemoveERC20Investment(i * 2000, false);
        testRemoveETHInvestment(i * 2000, true);
        testRemoveETHInvestment(i * 2000, false);
      }

      // Reverts

      it("should fail to remove an ERC20 investment when passing an invalid fraction value", async () => {
        const params = [wallet.address, token.address, 50000];
        await utils.assertRevert(investManager.removeInvestment(...params, { from: owner }), "CM: invalid fraction value");
      });

      it("should fail to remove an ERC20 investment when not holding any of the corresponding cToken", async () => {
        const params = [wallet.address, token.address, 5000];
        await utils.assertRevert(investManager.removeInvestment(...params, { from: owner }), "CM: amount cannot be 0");
      });

      it("should fail to remove all of an ERC20 investment when it collateralizes a loan", async () => {
        const collateralAmount = parseEther("1");
        const debtAmount = parseEther("0.001");
        await token.transfer(wallet.address, collateralAmount);
        const openLoanParams = [
          wallet.address,
          token.address,
          collateralAmount,
          ETH_TOKEN,
          debtAmount];
        await investManager.openLoan(...openLoanParams, { from: owner });
        const removeInvestmentParams = [wallet.address, token.address, 10000];
        await utils.assertRevert(investManager.removeInvestment(...removeInvestmentParams, { from: owner }), "CM: redeem failed");
      });
    });
  });
});
