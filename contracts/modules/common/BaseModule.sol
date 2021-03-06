// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../wallet/IWallet.sol";
import "../../infrastructure/IModuleRegistry.sol";
import "../../infrastructure/storage/IGuardianStorage.sol";
import "./IModule.sol";
import "../../../lib/other/ERC20.sol";

/**
 * @title BaseModule
 * @notice Basic module that contains methods common to all modules.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract BaseModule is IModule {

    // Empty calldata
    bytes constant internal EMPTY_BYTES = "";
    // Mock token address for ETH
    address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // The adddress of the module registry.
    IModuleRegistry internal registry;
    // The address of the Guardian storage
    IGuardianStorage internal guardianStorage;

    event ModuleCreated(bytes32 name);
    event ModuleInitialised(address wallet);

    /**
     * @notice Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(address _wallet) {
        require(!guardianStorage.isLocked(_wallet), "BM: wallet locked");
        _;
    }

    /**
     * @notice Throws if the sender is not the target wallet of the call.
     */
    modifier onlyWallet(address _wallet) {
        require(msg.sender == _wallet, "BM: caller must be wallet");
        _;
    }

    /**
     * @notice Throws if the sender is not the owner of the target wallet.
     */
    modifier onlyWalletOwner(address _wallet) {
        require(isOwner(_wallet, msg.sender), "BM: must be wallet owner");
        _;
    }

    /**
     * @notice Throws if the sender is not an authorised module of the target wallet.
     */
    modifier onlyWalletModule(address _wallet) {
        require(isAuthorisedModule(_wallet, msg.sender), "BM: must be a wallet module");
        _;
    }

    /**
     * @notice Throws if the sender is not the owner of the target wallet or the module itself.
     */
    modifier onlyWalletOwnerOrModule(address _wallet) {
        // Wrapping in an internal method reduces deployment cost by avoiding duplication of inlined code
        verifyOwnerOrAuthorisedModule(_wallet, msg.sender);
        _;
    }

    constructor(IModuleRegistry _registry, IGuardianStorage _guardianStorage, bytes32 _name) public {
        registry = _registry;
        guardianStorage = _guardianStorage;
        emit ModuleCreated(_name);
    }

    /**
    * @inheritdoc IModule
    */
    function recoverToken(address _token) external override {
        uint total = ERC20(_token).balanceOf(address(this));
        _token.call(abi.encodeWithSelector(ERC20(_token).transfer.selector, address(registry), total));
    }

    /**
     * @notice Inits the module for a wallet by logging an event.
     * The method can only be called by the wallet itself.
     * @param _wallet The wallet.
     */
    function init(address _wallet) public virtual override onlyWallet(_wallet) {
        emit ModuleInitialised(_wallet);
    }

    /**
     * @inheritdoc IModule
     */
    function addModule(address _wallet, address _module) public virtual override onlyWalletOwner(_wallet) onlyWhenUnlocked(_wallet) {
        require(registry.isRegisteredModule(_module), "BM: module is not registered");
        IWallet(_wallet).authoriseModule(_module, true);
    }

    /**
     * @inheritdoc IModule
     */
    function getRequiredSignatures(address _wallet, bytes calldata _data) external virtual override view returns (uint256, OwnerSignature) {
        revert("BM: disabled method");
    }

    /**
     * @notice Helper method to check if an address is the owner of a target wallet.
     * @param _wallet The target wallet.
     * @param _addr The address.
     */
    function isOwner(address _wallet, address _addr) internal view returns (bool) {
        return IWallet(_wallet).owner() == _addr;
    }

    /**
     * @notice Helper method to check if an address is an authorised module of a target wallet.
     * @param _wallet The target wallet.
     * @param _module The address.
     */
    function isAuthorisedModule(address _wallet, address _module) internal view returns (bool) {
        return IWallet(_wallet).authorised(_module);
    }

    /**
     * @notice Verify that the caller is an authorised module or the wallet owner.
     * @param _wallet The target wallet.
     * @param _sender The caller.
     */
    function verifyOwnerOrAuthorisedModule(address _wallet, address _sender) internal view {
        require(isAuthorisedModule(_wallet, _sender) || isOwner(_wallet, _sender), "BM: must be owner or module");
    }

    /**
     * @notice Helper method to invoke a wallet.
     * @param _wallet The target wallet.
     * @param _to The target address for the transaction.
     * @param _value The value of the transaction.
     * @param _data The data of the transaction.
     */
    function invokeWallet(address _wallet, address _to, uint256 _value, bytes memory _data) internal returns (bytes memory _res) {
        bool success;
        (success, _res) = _wallet.call(abi.encodeWithSignature("invoke(address,uint256,bytes)", _to, _value, _data));
        if (success && _res.length > 0) { //_res is empty if _wallet is an "old" BaseWallet that can't return output values
            (_res) = abi.decode(_res, (bytes));
        } else if (_res.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        } else if (!success) {
            revert("BM: wallet invoke reverted");
        }
    }

}