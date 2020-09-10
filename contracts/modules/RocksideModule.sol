// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./common/Utils.sol";
import "./common/BaseModule.sol";
import "./RelayerModule.sol";

contract RocksideModule is RelayerModule, BaseModule {
	map(address => map(address => bool)) public owners;

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
		address signer = Utils.recoverSigner(_signHash, _signatures, i);
		return owners[wallet][signer] == true;
	}

	function getRequiredSignatures(BaseWallet /* _wallet */, bytes memory /* _data */) internal view returns (uint256) {
		return 1;
	}

	// Overrides to use the incremental nonce and save some gas
	function checkAndUpdateUniqueness(BaseWallet _wallet, uint256 _nonce, bytes32 /* _signHash */) internal returns (bool) {
		return checkAndUpdateNonce(_wallet, _nonce);
	}
}
