// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.5.4;

import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";

contract RocksideModule is BaseModule, RelayerModule {
	bytes32 constant NAME = "RocksideModule";

	mapping(address => mapping(address => bool)) public owners;

	mapping(address => uint256) nonces;

	event ModuleCreated();

	modifier ownersOnly(BaseWallet _wallet) {
		require(owners[address(_wallet)][msg.sender], "BW: msg.sender not an authorized owner");
		_;
	}

	constructor(
		ModuleRegistry _registry, GuardianStorage _guardianStorage
	)
	BaseModule(_registry, _guardianStorage, NAME)
	public
	{
		emit ModuleCreated();
	}

	function validateSignatures(
		BaseWallet _wallet,
		bytes memory /* _data */,
		bytes32 _signHash,
		bytes memory _signatures
	)
	internal
	view
	returns (bool)
	{
		address signer = recoverSigner(_signHash, _signatures, 0);
		return owners[address(_wallet)][signer];
	}

	function updateOwner(BaseWallet _wallet, address _owner, bool value)
	external
	ownersOnly(_wallet)
	{
		owners[address(_wallet)][_owner] = value;
	}

	function init(BaseWallet _wallet) public onlyWallet(_wallet) {
		address walletOwner = _wallet.owner();

		require(owners[address(_wallet)][walletOwner], "RM: wallet is already initialized");
		owners[address(_wallet)][walletOwner] = true;
	}

	function getRequiredSignatures(BaseWallet /* _wallet */, bytes memory /* _data */) internal view returns (uint256) {
		return 1;
	}

	// Overrides to use the incremental nonce and save some gas
	function checkAndUpdateUniqueness(BaseWallet _wallet, uint256 _nonce, bytes32 /* _signHash */) internal returns (bool) {
		if (_nonce <= nonces[address(_wallet)]) {
			return false;
		}
		nonces[address(_wallet)] = _nonce;
		return  true;
	}
}
