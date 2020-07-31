// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.0;

import "../contracts/modules/common/OnlyOwnerModule.sol";

/**
 * @title TestOnlyOwnerModule
 * @notice Basic test onlyowner module.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract TestOnlyOwnerModule is OnlyOwnerModule {

    bytes32 constant NAME = "TestOnlyOwnerModule";
    constructor(IModuleRegistry _registry, IGuardianStorage _guardianStorage) BaseModule(_registry, _guardianStorage, NAME) {}
}